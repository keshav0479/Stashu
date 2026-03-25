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

// Change proofs — excess sats returned by the mint after melts
db.exec(`
  CREATE TABLE IF NOT EXISTS change_proofs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_pubkey TEXT NOT NULL,
    token TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    source TEXT NOT NULL,
    consumed INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_change_proofs_seller ON change_proofs(seller_pubkey);
`);

// Pending melts — tracks in-flight Lightning payments for crash recovery
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_melts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_pubkey TEXT NOT NULL,
    quote_id TEXT NOT NULL,
    proofs_json TEXT NOT NULL,
    invoice TEXT NOT NULL,
    amount_sats INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_pending_melts_status ON pending_melts(status);
`);

/**
 * Insert a change proof returned by the mint after a melt.
 * The token should already be encrypted before calling this.
 */
export function insertChangeProof(
  sellerPubkey: string,
  encryptedToken: string,
  amountSats: number,
  source: 'manual_withdraw' | 'auto_settle'
) {
  db.prepare(
    `INSERT INTO change_proofs (seller_pubkey, token, amount_sats, source)
     VALUES (?, ?, ?, ?)`
  ).run(sellerPubkey, encryptedToken, amountSats, source);
}

/**
 * Get all unconsumed change proofs for a seller.
 * Returns encrypted tokens — caller must decrypt.
 */
export function getUnconsumedChangeProofs(sellerPubkey: string) {
  return db
    .prepare(
      `SELECT id, token, amount_sats FROM change_proofs
       WHERE seller_pubkey = ? AND consumed = 0`
    )
    .all(sellerPubkey) as Array<{ id: number; token: string; amount_sats: number }>;
}

/**
 * Mark change proofs as consumed (after they are re-melted or aggregated).
 */
export function markChangeProofsConsumed(ids: number[]) {
  const mark = db.prepare(`UPDATE change_proofs SET consumed = 1 WHERE id = ?`);
  const markAll = db.transaction(() => {
    for (const id of ids) {
      mark.run(id);
    }
  });
  markAll();
}

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

  // Null out expired claim tokens (column added in migration v5)
  try {
    const expiredClaims = db
      .prepare(
        `UPDATE payments SET claim_token = NULL, claim_expires_at = NULL
         WHERE claim_token IS NOT NULL AND claim_expires_at < ?`
      )
      .run(Math.floor(Date.now() / 1000));
    if (expiredClaims.changes > 0) {
      console.log(`🧹 Cleaned up ${expiredClaims.changes} expired claim token(s)`);
    }
  } catch {
    // Column doesn't exist yet (pre-migration v5), skip
  }
}

// Run cleanup on startup and every 5 minutes
cleanupStaleQuotes();
setInterval(cleanupStaleQuotes, 300_000).unref();

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

// --- Versioned migrations ---
// Each migration runs once, tracked by schema_version table.
// Never sniff content to detect encrypted vs plaintext — version tracking is deterministic.

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_version (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0);
`);

const currentVersion = (
  db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number }
).version;

{
  const { encrypt, decrypt } = await import('../lib/encryption.js');

  // Key-rotation safety check (runs every startup, not a migration).
  // Verifies TOKEN_ENCRYPTION_KEY can decrypt all existing encrypted data.
  // If ops rotated the key without re-encrypting, we fail fast instead of serving garbage.
  if (currentVersion >= 1) {
    const encryptedTokens = db
      .prepare(
        `SELECT id, seller_token FROM payments
         WHERE seller_token IS NOT NULL AND seller_token NOT LIKE 'cashu%'`
      )
      .all() as Array<{ id: string; seller_token: string }>;

    for (const row of encryptedTokens) {
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
  }

  const migrations: Array<{ version: number; name: string; run: () => void }> = [
    {
      version: 1,
      name: 'encrypt plaintext seller tokens',
      run: () => {
        const rows = db
          .prepare(
            `SELECT id, seller_token FROM payments
             WHERE seller_token IS NOT NULL AND seller_token LIKE 'cashu%'`
          )
          .all() as Array<{ id: string; seller_token: string }>;
        if (rows.length === 0) return;
        const update = db.prepare(`UPDATE payments SET seller_token = ? WHERE id = ?`);
        for (const row of rows) {
          update.run(encrypt(row.seller_token), row.id);
        }
        console.log(`🔐 Encrypted ${rows.length} plaintext seller token(s).`);
      },
    },
    {
      version: 2,
      name: 'encrypt plaintext secret keys',
      run: () => {
        const rows = db.prepare(`SELECT id, secret_key FROM stashes`).all() as Array<{
          id: string;
          secret_key: string;
        }>;
        if (rows.length === 0) return;
        const update = db.prepare(`UPDATE stashes SET secret_key = ? WHERE id = ?`);
        for (const row of rows) {
          update.run(encrypt(row.secret_key), row.id);
        }
        console.log(`🔐 Encrypted ${rows.length} secret key(s).`);
      },
    },
    {
      version: 3,
      name: 'encrypt plaintext stash metadata',
      run: () => {
        const rows = db
          .prepare(`SELECT id, title, description, file_name FROM stashes`)
          .all() as Array<{
          id: string;
          title: string;
          description: string | null;
          file_name: string;
        }>;
        if (rows.length === 0) return;
        const update = db.prepare(
          `UPDATE stashes SET title = ?, description = ?, file_name = ? WHERE id = ?`
        );
        for (const row of rows) {
          update.run(
            encrypt(row.title),
            row.description ? encrypt(row.description) : null,
            encrypt(row.file_name),
            row.id
          );
        }
        console.log(`🔐 Encrypted metadata for ${rows.length} stash(es).`);
      },
    },
    {
      version: 4,
      name: 'encrypt plaintext LN addresses',
      run: () => {
        const settings = db
          .prepare(`SELECT pubkey, ln_address FROM seller_settings WHERE ln_address IS NOT NULL`)
          .all() as Array<{ pubkey: string; ln_address: string }>;
        if (settings.length > 0) {
          const update = db.prepare(`UPDATE seller_settings SET ln_address = ? WHERE pubkey = ?`);
          for (const row of settings) {
            update.run(encrypt(row.ln_address), row.pubkey);
          }
          console.log(`🔐 Encrypted ${settings.length} LN address(es) in seller_settings.`);
        }

        const logs = db
          .prepare(`SELECT id, ln_address FROM settlement_log WHERE ln_address IS NOT NULL`)
          .all() as Array<{ id: number; ln_address: string }>;
        if (logs.length > 0) {
          const update = db.prepare(`UPDATE settlement_log SET ln_address = ? WHERE id = ?`);
          for (const row of logs) {
            update.run(encrypt(row.ln_address), row.id);
          }
          console.log(`🔐 Encrypted ${logs.length} LN address(es) in settlement_log.`);
        }
      },
    },
    {
      version: 5,
      name: 'add claim token columns to payments',
      run: () => {
        db.exec(`ALTER TABLE payments ADD COLUMN claim_token TEXT DEFAULT NULL`);
        db.exec(`ALTER TABLE payments ADD COLUMN claim_expires_at INTEGER DEFAULT NULL`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_claim_token ON payments(claim_token)`);
        console.log('🎫 Added claim_token and claim_expires_at columns to payments.');
      },
    },
  ];

  // Run pending migrations in a transaction
  const pending = migrations.filter((m) => m.version > currentVersion);
  if (pending.length > 0) {
    const runMigrations = db.transaction(() => {
      for (const migration of pending) {
        console.log(`📦 Running migration v${migration.version}: ${migration.name}`);
        migration.run();
        db.prepare('UPDATE schema_version SET version = ? WHERE id = 1').run(migration.version);
      }
    });
    runMigrations();
    console.log(`✅ Migrations complete. Schema version: ${pending[pending.length - 1].version}`);
  }
}

export default db;
