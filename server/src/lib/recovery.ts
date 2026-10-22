import db from '../db/index.js';
import {
  checkMeltQuoteStatus,
  checkMintQuoteStatus,
  isQuoteAlreadyIssued,
  mintAfterPayment,
  verifyAndSwapToken,
} from './cashu.js';
import { encrypt, decrypt } from './encryption.js';
import { tryAutoSettle } from './autosettle.js';

interface PendingMeltRow {
  id: number;
  seller_pubkey: string;
  quote_id: string;
  proofs_json: string;
  invoice: string;
  amount_sats: number;
  status: string;
}

/**
 * On startup, check if any melts were left in 'pending' state (server crashed mid-melt).
 * For each one, check the quote status with the mint to see if the payment actually went through.
 */
export async function recoverPendingMelts(): Promise<void> {
  const pending = db
    .prepare(`SELECT * FROM pending_melts WHERE status = 'pending'`)
    .all() as PendingMeltRow[];

  if (pending.length === 0) return;

  console.log(`🔄 Found ${pending.length} pending melt(s) — checking with mint...`);

  for (const row of pending) {
    try {
      const result = await checkMeltQuoteStatus(row.quote_id);

      if (result.state === 'PAID') {
        // The melt actually succeeded — mark completed
        db.prepare(`UPDATE pending_melts SET status = 'completed' WHERE id = ?`).run(row.id);
        console.log(
          `✅ Melt ${row.quote_id.substring(0, 8)}... was PAID (${row.amount_sats} sats). ` +
            `Marked completed.`
        );
      } else if (result.state === 'UNPAID' || result.state === 'EXPIRED') {
        // Melt never went through — proofs may still be valid
        db.prepare(`UPDATE pending_melts SET status = 'failed' WHERE id = ?`).run(row.id);
        console.log(
          `❌ Melt ${row.quote_id.substring(0, 8)}... was ${result.state}. Marked failed.`
        );
      } else {
        // PENDING state at the mint — still in-flight, leave for next restart
        console.log(
          `⏳ Melt ${row.quote_id.substring(0, 8)}... still ${result.state} at mint. Will retry.`
        );
      }
    } catch (error) {
      console.error(`⚠️ Failed to check melt ${row.quote_id.substring(0, 8)}...:`, error);
      // Don't mark as failed — will retry next startup
    }
  }
}

interface LightningPaymentRow {
  id: string;
  stash_id: string;
  token_hash: string; // stores the quoteId for Lightning payments
}

/**
 * What to mint for a paid Lightning quote: exactly what its invoice was for.
 * NUT-04 only issues what is asked for, so asking for less would strand the
 * rest on the quote. Every invoice is made for the stash price.
 */
function invoiceAmount(stash: { price_sats: number }): number {
  return stash.price_sats;
}

/**
 * Mint a paid Lightning quote, swap the minted tokens into the seller's token,
 * and mark the payment paid. Returns false, leaving the row as it was, when the
 * stash is missing or the swap fails; throws when minting fails.
 */
async function mintAndCredit(row: LightningPaymentRow): Promise<boolean> {
  const stash = db
    .prepare('SELECT price_sats, seller_pubkey FROM stashes WHERE id = ?')
    .get(row.stash_id) as { price_sats: number; seller_pubkey: string } | undefined;

  if (!stash) {
    console.error(
      `⚠️ Stash ${row.stash_id.substring(0, 8)}... not found for payment ${row.id.substring(0, 8)}... — skipping`
    );
    return false;
  }

  const quoteId = row.token_hash;
  const amountSats = invoiceAmount(stash);

  // Mint tokens from the paid invoice
  const mintedToken = await mintAfterPayment(amountSats, quoteId);

  // Swap minted tokens to create seller's token
  const swapResult = await verifyAndSwapToken(mintedToken, amountSats);

  if (!swapResult.success || !swapResult.sellerToken) {
    console.error(`  ❌ Swap failed for payment ${row.id.substring(0, 8)}...: ${swapResult.error}`);
    return false;
  }

  // Success! Update payment to 'paid' with encrypted seller token
  db.prepare(
    `UPDATE payments SET status = 'paid', seller_token = ?, paid_at = unixepoch() WHERE id = ?`
  ).run(encrypt(swapResult.sellerToken), row.id);

  console.log(`  ✅ Recovered payment ${row.id.substring(0, 8)}... — ${amountSats} sats`);

  // Trigger auto-settlement check
  tryAutoSettle(stash.seller_pubkey).catch((err) =>
    console.error('Auto-settle failed:', err instanceof Error ? err.message : err)
  );
  return true;
}

/**
 * On startup, retry minting for payments stuck in 'mint_failed' state.
 * These are payments where the buyer's Lightning invoice was paid but the
 * server crashed before minting + swapping the Cashu tokens.
 */
export async function recoverMintFailures(): Promise<void> {
  const failed = db
    .prepare(`SELECT id, stash_id, token_hash FROM payments WHERE status = 'mint_failed'`)
    .all() as LightningPaymentRow[];

  if (failed.length === 0) return;

  console.log(`🔄 Found ${failed.length} mint_failed payment(s) — retrying...`);

  for (const row of failed) {
    try {
      console.log(
        `  Retrying mint for payment ${row.id.substring(0, 8)}... (quote: ${row.token_hash.substring(0, 8)}...)`
      );
      // On failure the row stays mint_failed — will retry next startup
      await mintAndCredit(row);
    } catch (error) {
      if (isQuoteAlreadyIssued(error)) {
        // The mint issued this quote's ecash to a caller that lost it — no
        // retry can ever succeed. Keep the row as evidence, stop retrying.
        db.prepare(`UPDATE payments SET status = 'mint_lost' WHERE id = ?`).run(row.id);
        console.error(
          `  🪦 Payment ${row.id.substring(0, 8)}... marked mint_lost: quote already issued, ` +
            `funds were minted earlier and lost before being stored. Needs manual follow-up.`
        );
        continue;
      }
      console.error(`  ⚠️ Recovery failed for payment ${row.id.substring(0, 8)}...:`, error);
      // Leave as mint_failed — will retry next startup
    }
  }
}

// A Lightning payment still 'pending' this long after its invoice was made
// is checked with the mint: the buyer's page has most likely stopped polling.
const STALE_QUOTE_SECONDS = 3600;
// A payment made just before its invoice expires can take a moment to show up
// at the mint, so an unpaid quote is only deleted this long after it expires.
const EXPIRY_GRACE_SECONDS = 300;

// Unpaid quotes whose invoice can still be paid, by payment id, with when to
// ask the mint about them again. Without this, a mint whose invoices last a
// day would be asked about every abandoned invoice every 5 minutes.
const recheckAt = new Map<string, number>();

interface StaleQuoteRow extends LightningPaymentRow {
  created_at: number;
}

/**
 * Mint a quote that was paid but never collected. Claims the row first, the
 * same way the pay route does, so a buyer polling at the same moment can never
 * mint it too.
 */
async function collectPaidQuote(row: StaleQuoteRow): Promise<void> {
  const claimed = db
    .prepare(`UPDATE payments SET status = 'processing' WHERE id = ? AND status = 'pending'`)
    .run(row.id);
  if (claimed.changes === 0) return; // A buyer's poll got there first

  console.log(
    `💰 Quote ${row.token_hash.substring(0, 8)}... was paid but never collected — minting`
  );
  try {
    if (await mintAndCredit(row)) return;
  } catch (error) {
    console.error(`  ⚠️ Mint failed for payment ${row.id.substring(0, 8)}...:`, error);
  }
  // Paid but not credited — same as a failed mint in the pay route, so
  // recoverMintFailures retries it on the next startup
  db.prepare(`UPDATE payments SET status = 'mint_failed' WHERE id = ?`).run(row.id);
}

async function runStaleQuoteCleanup(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const stale = db
    .prepare(
      `SELECT id, stash_id, token_hash, created_at FROM payments
       WHERE status = 'pending' AND id LIKE 'ln-%' AND created_at < ?
       ORDER BY created_at`
    )
    .all(now - STALE_QUOTE_SECONDS) as StaleQuoteRow[];

  // Forget quotes that stopped being pending, e.g. a buyer's poll settled them
  const staleIds = new Set(stale.map((row) => row.id));
  for (const id of recheckAt.keys()) {
    if (!staleIds.has(id)) recheckAt.delete(id);
  }

  let deleted = 0;
  for (const row of stale) {
    if ((recheckAt.get(row.id) ?? 0) > now) continue;

    let quote: { state: string; expiresAt: number | null };
    try {
      quote = await checkMintQuoteStatus(row.token_hash);
    } catch (error) {
      // Mint unreachable — keep the row, retry next run
      console.error(`⚠️ Failed to check quote ${row.token_hash.substring(0, 8)}...:`, error);
      continue;
    }
    recheckAt.delete(row.id);

    if (quote.state === 'PAID') {
      await collectPaidQuote(row);
    } else if (quote.state === 'UNPAID') {
      // BOLT11 invoices expire after an hour unless they say otherwise
      const expiresAt = quote.expiresAt ?? row.created_at + 3600;
      if (now < expiresAt + EXPIRY_GRACE_SECONDS) {
        // The buyer can still pay it — ask again once it has expired
        recheckAt.set(row.id, expiresAt + EXPIRY_GRACE_SECONDS);
      } else {
        deleted += db
          .prepare(`DELETE FROM payments WHERE id = ? AND status = 'pending'`)
          .run(row.id).changes;
      }
    } else if (quote.state === 'ISSUED') {
      // Paid, but its tokens were minted without this row being updated (a
      // crash mid-mint, or someone else holding the quote id), so there is
      // nothing left to mint. Flag it the way a buyer's poll would.
      const flagged = db
        .prepare(`UPDATE payments SET status = 'mint_failed' WHERE id = ? AND status = 'pending'`)
        .run(row.id);
      if (flagged.changes > 0) {
        console.error(
          `❌ Quote ${row.token_hash.substring(0, 8)}... was already ISSUED but never credited. ` +
            `Marked mint_failed.`
        );
      }
    } else {
      // Not a state we know — never delete what might have been paid
      console.log(
        `⏳ Quote ${row.token_hash.substring(0, 8)}... is ${quote.state} at mint. Will retry.`
      );
    }
  }

  if (deleted > 0) {
    console.log(`🧹 Cleaned up ${deleted} stale pending quotes`);
  }

  // Recover stuck 'processing' rows (server crash recovery, 5 min timeout).
  // This runs after the checks above, so a run never acts on a row it just
  // reset: that row may belong to a buyer's poll that is minting it right now.
  const recovered = db
    .prepare(
      `UPDATE payments SET status = 'pending' WHERE status = 'processing' AND id LIKE 'ln-%' AND created_at < ?`
    )
    .run(now - 300);
  if (recovered.changes > 0) {
    console.log(`🔄 Reset ${recovered.changes} stuck processing payments to pending`);
  }

  // Keep expired claim tokens so /api/unlock/:id/claim can return 410
  // instead of treating a known-but-expired local token as unknown.
}

let staleQuoteCleanup: Promise<void> | null = null;

/**
 * Settle or clear Lightning payments still 'pending' an hour after their
 * invoice was made. A row only leaves 'pending' when the buyer's page polls
 * it, so a buyer who paid and then closed the tab leaves a paid quote behind.
 * Asks the mint about each one:
 *   PAID   — mint and credit it, the same way recoverMintFailures does
 *   UNPAID — delete it once its invoice has expired, keep it until then
 *   ISSUED — mark it mint_failed: its tokens were minted but never recorded
 * Rows the mint gives no clear answer for are kept for the next run: nothing
 * is deleted unless the mint confirms it was never paid.
 *
 * Also resets 'processing' rows left behind by a crash mid-mint.
 */
export function cleanupStaleQuotes(): Promise<void> {
  // One run at a time: against a slow mint, a run can outlast the interval
  if (!staleQuoteCleanup) {
    staleQuoteCleanup = runStaleQuoteCleanup().finally(() => {
      staleQuoteCleanup = null;
    });
  }
  return staleQuoteCleanup;
}
