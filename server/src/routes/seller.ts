import { Hono } from 'hono';
import db from '../db/index.js';
import { decrypt } from '../lib/encryption.js';
import type {
  GeneratedPreviewPayload,
  StashProof,
  StashPublicInfo,
  APIResponse,
} from '../../../shared/types.js';
import { DEFAULT_DOWNLOAD_WINDOW_SECONDS } from '../../../shared/types.js';
import type { StashRow } from '../db/types.js';

export const sellerRoutes = new Hono();
const SEALED_BLOB_FORMAT = 'stashu-selective-v1';

function parseStoredJson<T>(value: string | null): T | undefined {
  return value ? (JSON.parse(decrypt(value)) as T) : undefined;
}

// GET /api/seller/:pubkey - Get all stashes by a seller (public, no auth)
sellerRoutes.get('/:pubkey', async (c) => {
  try {
    const pubkey = c.req.param('pubkey');

    // Validate pubkey format (64 hex chars)
    if (!/^[0-9a-f]{64}$/.test(pubkey)) {
      return c.json<APIResponse<never>>({ success: false, error: 'Invalid pubkey format' }, 400);
    }

    // Check if seller has enabled their storefront (also proves they exist)
    const settings = db
      .prepare('SELECT storefront_enabled FROM seller_settings WHERE pubkey = ?')
      .get(pubkey) as { storefront_enabled: number } | undefined;

    if (!settings) {
      // No settings row → check if they have stashes (used Stashu but never saved settings)
      const hasStashes = db
        .prepare('SELECT 1 FROM stashes WHERE seller_pubkey = ? LIMIT 1')
        .get(pubkey);

      if (!hasStashes) {
        return c.json<APIResponse<never>>({ success: false, error: 'Seller not found' }, 404);
      }

      // Seller exists but never enabled storefront
      return c.json<APIResponse<never>>(
        { success: false, error: 'Storefront is not enabled' },
        404
      );
    }

    if (settings.storefront_enabled !== 1) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'Storefront is not enabled' },
        404
      );
    }

    const stmt = db.prepare(`
      SELECT id, title, description, file_name, file_size, price_sats, blob_url, blob_sha256,
             blob_format, preview_url, generated_preview_payload, preview_proof,
             download_window_seconds, created_at
      FROM stashes
      WHERE seller_pubkey = ? AND show_in_storefront = 1
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(pubkey) as Pick<
      StashRow,
      | 'id'
      | 'title'
      | 'description'
      | 'file_name'
      | 'file_size'
      | 'price_sats'
      | 'blob_url'
      | 'blob_sha256'
      | 'blob_format'
      | 'preview_url'
      | 'generated_preview_payload'
      | 'preview_proof'
      | 'download_window_seconds'
      | 'created_at'
    >[];

    const stashes: StashPublicInfo[] = rows.map((row) => ({
      id: row.id,
      title: decrypt(row.title),
      description: row.description ? decrypt(row.description) : undefined,
      fileName: decrypt(row.file_name),
      fileSize: row.file_size,
      priceSats: row.price_sats,
      blobFormat: row.blob_format === SEALED_BLOB_FORMAT ? SEALED_BLOB_FORMAT : undefined,
      sealedBlobUrl: row.blob_format === SEALED_BLOB_FORMAT ? decrypt(row.blob_url) : undefined,
      blobSha256:
        row.blob_format === SEALED_BLOB_FORMAT ? (row.blob_sha256 ?? undefined) : undefined,
      previewUrl: row.preview_url ?? undefined,
      generatedPreview: parseStoredJson<GeneratedPreviewPayload>(row.generated_preview_payload),
      previewProof: parseStoredJson<StashProof>(row.preview_proof),
      downloadWindowSeconds: row.download_window_seconds ?? DEFAULT_DOWNLOAD_WINDOW_SECONDS,
    }));

    return c.json<APIResponse<StashPublicInfo[]>>({
      success: true,
      data: stashes,
    });
  } catch (error) {
    console.error('Error fetching seller storefront:', error);
    return c.json<APIResponse<never>>(
      {
        success: false,
        error: 'Failed to fetch storefront',
      },
      500
    );
  }
});
