import db, { insertChangeProof } from '../db/index.js';
import { resolveAddress } from './lnaddress.js';
import { meltWithRecovery, getMeltQuote, getTokenValue } from './cashu.js';
import { decrypt, encrypt } from './encryption.js';

interface SettingsRow {
  pubkey: string;
  ln_address: string | null;
  auto_withdraw_threshold: number;
}

function logSettlement(
  sellerPubkey: string,
  status: 'success' | 'failed' | 'skipped',
  data: { amount?: number; fee?: number; net?: number; lnAddress?: string; error?: string }
) {
  db.prepare(
    `INSERT INTO settlement_log (seller_pubkey, status, amount_sats, fee_sats, net_sats, ln_address, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sellerPubkey,
    status,
    data.amount || null,
    data.fee || null,
    data.net || null,
    data.lnAddress || null,
    data.error || null
  );
}

/**
 * Try auto-settlement for a seller after a new payment comes in.
 * Runs in the background — errors are logged but never block the caller.
 */
export async function tryAutoSettle(sellerPubkey: string): Promise<void> {
  try {
    // 1. Check if seller has auto-settlement configured
    const settings = db
      .prepare('SELECT * FROM seller_settings WHERE pubkey = ?')
      .get(sellerPubkey) as SettingsRow | undefined;

    if (!settings?.ln_address || !settings.auto_withdraw_threshold) {
      return; // Auto-settlement not configured
    }

    // 2. Check current unclaimed balance
    const result = db
      .prepare(
        `SELECT SUM(s.price_sats) as total
         FROM payments p
         JOIN stashes s ON p.stash_id = s.id
         WHERE s.seller_pubkey = ? AND p.status = 'paid' AND p.claimed = 0 AND p.seller_token IS NOT NULL`
      )
      .get(sellerPubkey) as { total: number | null };

    const balance = result?.total || 0;

    if (balance < settings.auto_withdraw_threshold) {
      return; // Below threshold — don't log, this is normal
    }

    console.log(
      `⚡ Auto-settlement triggered for ${sellerPubkey.substring(0, 8)}... ` +
        `(balance: ${balance} sats, threshold: ${settings.auto_withdraw_threshold} sats)`
    );

    // 3. Get all unclaimed tokens
    const tokens = db
      .prepare(
        `SELECT p.id, p.seller_token
         FROM payments p
         JOIN stashes s ON p.stash_id = s.id
         WHERE s.seller_pubkey = ? AND p.status = 'paid' AND p.claimed = 0 AND p.seller_token IS NOT NULL`
      )
      .all(sellerPubkey) as Array<{ id: string; seller_token: string }>;

    if (tokens.length === 0) return;

    // 4. Resolve LN address: first get fee, then resolve for net amount
    let tempInvoice: string;
    try {
      tempInvoice = await resolveAddress(settings.ln_address, balance);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to resolve LN address';
      logSettlement(sellerPubkey, 'failed', {
        amount: balance,
        lnAddress: settings.ln_address,
        error,
      });
      console.error('Auto-settlement: LN resolve failed:', error);
      return;
    }

    const tempQuote = await getMeltQuote(tempInvoice);

    if (!tempQuote.success || !tempQuote.feeSats) {
      logSettlement(sellerPubkey, 'failed', {
        amount: balance,
        lnAddress: settings.ln_address,
        error: 'Failed to get fee estimate from mint',
      });
      return;
    }

    const netAmount = balance - tempQuote.feeSats;
    if (netAmount <= 0) {
      logSettlement(sellerPubkey, 'skipped', {
        amount: balance,
        fee: tempQuote.feeSats,
        lnAddress: settings.ln_address,
        error: `Balance ${balance} too low to cover ${tempQuote.feeSats} fee`,
      });
      return;
    }

    // Re-resolve for the correct net amount
    let finalInvoice: string;
    try {
      finalInvoice = await resolveAddress(settings.ln_address, netAmount);
    } catch (err) {
      const error =
        err instanceof Error ? err.message : 'Failed to resolve LN address for net amount';
      logSettlement(sellerPubkey, 'failed', {
        amount: balance,
        fee: tempQuote.feeSats,
        net: netAmount,
        lnAddress: settings.ln_address,
        error,
      });
      return;
    }

    // 5. Melt tokens to pay the invoice
    const tokenStrings = tokens.map((t) => decrypt(t.seller_token));
    const meltResult = await meltWithRecovery(tokenStrings, finalInvoice, sellerPubkey);

    if (!meltResult.success) {
      logSettlement(sellerPubkey, 'failed', {
        amount: balance,
        fee: tempQuote.feeSats,
        net: netAmount,
        lnAddress: settings.ln_address,
        error: meltResult.error || 'Melt failed (Lightning payment error)',
      });
      return;
    }

    // 6. Mark all tokens as claimed
    const markClaimed = db.prepare('UPDATE payments SET claimed = 1 WHERE id = ?');
    const markAll = db.transaction(() => {
      for (const token of tokens) {
        markClaimed.run(token.id);
      }
    });
    markAll();

    // Persist change proofs if the mint returned excess sats
    if (meltResult.changeToken) {
      const changeSats = getTokenValue(meltResult.changeToken);
      if (changeSats > 0) {
        insertChangeProof(sellerPubkey, encrypt(meltResult.changeToken), changeSats, 'auto_settle');
        console.log(
          `💰 Auto-settle: persisted ${changeSats} sats of change proofs for ${sellerPubkey.substring(0, 8)}...`
        );
      }
    }

    // 7. Log success
    logSettlement(sellerPubkey, 'success', {
      amount: balance,
      fee: tempQuote.feeSats,
      net: netAmount,
      lnAddress: settings.ln_address,
    });

    console.log(
      `✅ Auto-settlement complete: ${netAmount} sats sent to ${settings.ln_address} ` +
        `(fee: ${tempQuote.feeSats} sats, ${tokens.length} tokens claimed)`
    );
  } catch (error) {
    // Catch-all — never let auto-settlement errors propagate
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    try {
      logSettlement(sellerPubkey, 'failed', { error: errorMsg });
    } catch {
      // If even logging fails, just console
    }
    console.error('Auto-settlement error:', error);
  }
}
