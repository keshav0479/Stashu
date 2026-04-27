/**
 * Database row types — mirror the actual SQLite column names (snake_case).
 * Use Pick<T, ...> when a query selects only a subset of columns.
 *
 * Encrypted columns: blob_url, secret_key, title, description, file_name,
 *                    generated_preview_payload, preview_proof, preview_secret (stashes);
 *                    seller_token (payments); ln_address (seller_settings, settlement_log).
 * Callers must decrypt() before use and encrypt() before insert/update.
 */

export interface StashRow {
  id: string;
  blob_url: string; // encrypted
  blob_sha256: string | null;
  secret_key: string; // encrypted
  key_backup: string | null;
  seller_pubkey: string;
  price_sats: number;
  title: string; // encrypted
  description: string | null; // encrypted
  file_name: string; // encrypted
  file_size: number;
  preview_url: string | null;
  generated_preview_payload: string | null; // encrypted public metadata
  preview_proof: string | null; // encrypted public metadata
  preview_secret: string | null; // encrypted
  show_in_storefront: number;
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
