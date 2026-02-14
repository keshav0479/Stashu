import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'stashu.db');

const db: DatabaseType = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS stashes (
    id TEXT PRIMARY KEY,
    blob_url TEXT NOT NULL,
    secret_key TEXT NOT NULL,
    key_backup TEXT,
    seller_pubkey TEXT NOT NULL,
    price_sats INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    file_name TEXT NOT NULL DEFAULT 'file',
    file_size INTEGER NOT NULL,
    preview_url TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    stash_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    token_hash TEXT NOT NULL,
    seller_token TEXT,
    claimed INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    paid_at INTEGER,
    FOREIGN KEY (stash_id) REFERENCES stashes(id)
  );

  CREATE INDEX IF NOT EXISTS idx_payments_stash ON payments(stash_id);
  CREATE INDEX IF NOT EXISTS idx_payments_seller ON stashes(seller_pubkey);
`);

// Migration: add claimed column if it doesn't exist (for existing DBs)
try {
  db.exec(`ALTER TABLE payments ADD COLUMN claimed INTEGER DEFAULT 0`);
} catch {
  // Column already exists, ignore
}

// Create index after migration ensures column exists
db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_claimed ON payments(claimed)`);

// Seller settings for auto-settlement
db.exec(`
  CREATE TABLE IF NOT EXISTS seller_settings (
    pubkey TEXT PRIMARY KEY,
    ln_address TEXT,
    auto_withdraw_threshold INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
`);

// Settlement history log
db.exec(`
  CREATE TABLE IF NOT EXISTS settlement_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_pubkey TEXT NOT NULL,
    status TEXT NOT NULL,
    amount_sats INTEGER,
    fee_sats INTEGER,
    net_sats INTEGER,
    ln_address TEXT,
    error TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_settlement_seller ON settlement_log(seller_pubkey);
`);

// Cleanup stale Lightning quote bindings (unpaid invoices older than 1 hour)
// Also recover stuck 'processing' rows (server crash recovery, 5 min timeout)
function cleanupStaleQuotes() {
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
  const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;

  const deleted = db
    .prepare(`DELETE FROM payments WHERE status = 'pending' AND id LIKE 'ln-%' AND created_at < ?`)
    .run(oneHourAgo);

  const recovered = db
    .prepare(
      `UPDATE payments SET status = 'pending' WHERE status = 'processing' AND id LIKE 'ln-%' AND created_at < ?`
    )
    .run(fiveMinAgo);

  if (deleted.changes > 0) {
    console.log(`🧹 Cleaned up ${deleted.changes} stale pending quotes`);
  }
  if (recovered.changes > 0) {
    console.log(`🔄 Reset ${recovered.changes} stuck processing payments to pending`);
  }
}

// Run cleanup on startup and every 5 minutes
cleanupStaleQuotes();
setInterval(cleanupStaleQuotes, 300_000);

export default db;
