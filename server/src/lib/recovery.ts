import db from '../db/index.js';
import { checkMeltQuoteStatus } from './cashu.js';

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
