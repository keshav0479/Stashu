import db from '../db/index.js';
import { resolveAddress } from './lnaddress.js';
import { meltToLightning, getMeltQuote } from './cashu.js';

interface SettingsRow {
  pubkey: string;
  ln_address: string | null;
  auto_withdraw_threshold: number;
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
      return; // Below threshold
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
    const tempInvoice = await resolveAddress(settings.ln_address, balance);
    const tempQuote = await getMeltQuote(tempInvoice);

    if (!tempQuote.success || !tempQuote.feeSats) {
      console.error('Auto-settlement: failed to get fee estimate');
      return;
    }

    const netAmount = balance - tempQuote.feeSats;
    if (netAmount <= 0) {
      console.log(
        `Auto-settlement: balance ${balance} too low to cover ${tempQuote.feeSats} fee, skipping`
      );
      return;
    }

    // Re-resolve for the correct net amount
    const finalInvoice = await resolveAddress(settings.ln_address, netAmount);

    // 5. Melt tokens to pay the invoice
    const tokenStrings = tokens.map((t) => t.seller_token);
    const meltResult = await meltToLightning(tokenStrings, finalInvoice);

    if (!meltResult.success) {
      console.error('Auto-settlement melt failed:', meltResult.error);
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

    console.log(
      `✅ Auto-settlement complete: ${netAmount} sats sent to ${settings.ln_address} ` +
        `(fee: ${tempQuote.feeSats} sats, ${tokens.length} tokens claimed)`
    );
  } catch (error) {
    // Never let auto-settlement errors propagate — it's best-effort
    console.error('Auto-settlement error:', error);
  }
}
