/**
 * Database row types — mirror the actual SQLite column names (snake_case).
 * Use Pick<T, ...> when a query selects only a subset of columns.
 *
 * Encrypted columns: secret_key, title, description, file_name (stashes);
 *                    seller_token (payments); ln_address (seller_settings, settlement_log).
 * Callers must decrypt() before use and encrypt() before insert/update.
 */

export interface StashRow {
  id: string;
  blob_url: string;
  secret_key: string; // encrypted
  key_backup: string | null;
  seller_pubkey: string;
  price_sats: number;
  title: string; // encrypted
  description: string | null; // encrypted
  file_name: string; // encrypted
  file_size: number;
  preview_url: string | null;
  created_at: number;
}

export interface PaymentRow {
  id: string;
  stash_id: string;
  status: string;
  token_hash: string;
  seller_token: string | null; // encrypted
  claimed: number;
  created_at: number;
  paid_at: number | null;
  claim_token: string | null;
  claim_expires_at: number | null;
}
