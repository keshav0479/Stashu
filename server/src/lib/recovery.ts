import db from '../db/index.js';
import { checkMeltQuoteStatus, mintAfterPayment, verifyAndSwapToken } from './cashu.js';
import { encrypt } from './encryption.js';
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

interface MintFailedRow {
  id: string;
  stash_id: string;
  token_hash: string; // stores the quoteId for mint_failed payments
}

/**
 * On startup, retry minting for payments stuck in 'mint_failed' state.
 * These are payments where the buyer's Lightning invoice was paid but the
 * server crashed before minting + swapping the Cashu tokens.
 */
export async function recoverMintFailures(): Promise<void> {
  const failed = db
    .prepare(`SELECT id, stash_id, token_hash FROM payments WHERE status = 'mint_failed'`)
    .all() as MintFailedRow[];

  if (failed.length === 0) return;

  console.log(`🔄 Found ${failed.length} mint_failed payment(s) — retrying...`);

  for (const row of failed) {
    try {
      const stash = db
        .prepare('SELECT price_sats, seller_pubkey FROM stashes WHERE id = ?')
        .get(row.stash_id) as { price_sats: number; seller_pubkey: string } | undefined;

      if (!stash) {
        console.error(`⚠️ Stash ${row.stash_id} not found for payment ${row.id} — skipping`);
        continue;
      }

      const quoteId = row.token_hash;
      console.log(`  Retrying mint for payment ${row.id} (quote: ${quoteId.substring(0, 8)}...)`);

      // Retry minting tokens from the paid invoice
      const mintedToken = await mintAfterPayment(stash.price_sats, quoteId);

      // Swap minted tokens to create seller's token
      const swapResult = await verifyAndSwapToken(mintedToken, stash.price_sats);

      if (!swapResult.success || !swapResult.sellerToken) {
        console.error(`  ❌ Swap failed for payment ${row.id}: ${swapResult.error}`);
        continue; // Leave as mint_failed — will retry next startup
      }

      // Success! Update payment to 'paid' with encrypted seller token
      db.prepare(
        `UPDATE payments SET status = 'paid', seller_token = ?, paid_at = unixepoch() WHERE id = ?`
      ).run(encrypt(swapResult.sellerToken), row.id);

      console.log(`  ✅ Recovered payment ${row.id} — ${stash.price_sats} sats`);

      // Trigger auto-settlement check
      tryAutoSettle(stash.seller_pubkey).catch(() => {});
    } catch (error) {
      console.error(`  ⚠️ Recovery failed for payment ${row.id}:`, error);
      // Leave as mint_failed — will retry next startup
    }
  }
}
