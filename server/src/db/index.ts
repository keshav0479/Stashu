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

// Require TOKEN_ENCRYPTION_KEY — refuse to start without a valid key.
// Cashu tokens are bearer instruments; running without encryption is a security risk.
if (
  !process.env.TOKEN_ENCRYPTION_KEY ||
  !/^[0-9a-fA-F]{64}$/.test(process.env.TOKEN_ENCRYPTION_KEY)
) {
  console.error(
    '❌ TOKEN_ENCRYPTION_KEY is missing or invalid (must be exactly 64 hex chars).\n' +
      "   Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
  process.exit(1);
}

// One-time migration: encrypt any plaintext seller tokens still in the DB.
// Plaintext Cashu tokens always start with "cashu". We re-encrypt them so
// they are no longer readable to anyone with raw DB access.
{
  const { encrypt, decrypt } = await import('../lib/encryption.js');

  // Key-rotation safety: verify the current key can decrypt ALL existing ciphertext.
  // If ops rotated the key without re-encrypting rows, dashboard/earnings/withdraw
  // would crash at runtime. Checking every row catches mixed-key DBs too.
  const encryptedRows = db
    .prepare(
      `SELECT id, seller_token FROM payments
       WHERE seller_token IS NOT NULL AND seller_token NOT LIKE 'cashu%'`
    )
    .all() as Array<{ id: string; seller_token: string }>;

  for (const row of encryptedRows) {
    try {
      decrypt(row.seller_token);
    } catch {
      console.error(
        `❌ TOKEN_ENCRYPTION_KEY cannot decrypt token in payment ${row.id}.\n` +
          '   Did you rotate the key? Restore the previous key or re-encrypt the rows.'
      );
      process.exit(1);
    }
  }

  const plaintextRows = db
    .prepare(
      `SELECT id, seller_token FROM payments WHERE seller_token IS NOT NULL AND seller_token LIKE 'cashu%'`
    )
    .all() as Array<{ id: string; seller_token: string }>;

  if (plaintextRows.length > 0) {
    const update = db.prepare(`UPDATE payments SET seller_token = ? WHERE id = ?`);
    const migrateAll = db.transaction(() => {
      for (const row of plaintextRows) {
        update.run(encrypt(row.seller_token), row.id);
      }
    });
    migrateAll();
    console.log(`🔐 Encrypted ${plaintextRows.length} plaintext seller token(s) in DB.`);
  }
}

export default db;
