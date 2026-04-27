import { Hono } from 'hono';
import { createHash, randomBytes } from 'crypto';
import db from '../db/index.js';
import { verifyAndSwapToken } from '../lib/cashu.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { tryAutoSettle } from '../lib/autosettle.js';
import { rateLimit } from '../middleware/ratelimit.js';
import type {
  StashProofSecret,
  UnlockRequest,
  UnlockResponse,
  APIResponse,
} from '../../../shared/types.js';
import type { StashRow, PaymentRow } from '../db/types.js';

export const unlockRoutes = new Hono();

function decryptPreviewSecret(value: string | null): StashProofSecret | undefined {
  return value ? (JSON.parse(decrypt(value)) as StashProofSecret) : undefined;
}

// POST /api/unlock/:id - Unlock a stash with Cashu token
unlockRoutes.post('/:id', async (c) => {
  try {
    const stashId = c.req.param('id');
    const body = await c.req.json<UnlockRequest>();

    if (!body.token) {
      return c.json<APIResponse<never>>(
        {
          success: false,
          error: 'Token is required',
        },
        400
      );
    }

    // Get stash details
    const stashStmt = db.prepare(`
      SELECT id, blob_url, blob_sha256, secret_key, preview_secret, file_name, price_sats, seller_pubkey
      FROM stashes WHERE id = ?
    `);
    const stash = stashStmt.get(stashId) as Pick<
      StashRow,
      | 'id'
      | 'blob_url'
      | 'blob_sha256'
      | 'secret_key'
      | 'preview_secret'
      | 'file_name'
      | 'price_sats'
      | 'seller_pubkey'
    > | null;

    if (!stash) {
      return c.json<APIResponse<never>>(
        {
          success: false,
          error: 'Stash not found',
        },
        404
      );
    }

    // Create payment ID from full token hash (for idempotency)
    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    const paymentId = `${stashId}-${tokenHash}`;

    // Check if payment already exists
    const existingPayment = db
      .prepare('SELECT * FROM payments WHERE id = ?')
      .get(paymentId) as PaymentRow | null;

    if (existingPayment) {
      if (existingPayment.status === 'paid') {
        // Already paid - return the key (idempotent)
        // Regenerate claim token if missing or expired
        let claimToken = existingPayment.claim_token;
        const now = Math.floor(Date.now() / 1000);
        if (
          !claimToken ||
          !existingPayment.claim_expires_at ||
          existingPayment.claim_expires_at < now
        ) {
          claimToken = randomBytes(32).toString('hex');
          const claimExpiresAt = now + 3600;
          db.prepare(`UPDATE payments SET claim_token = ?, claim_expires_at = ? WHERE id = ?`).run(
            claimToken,
            claimExpiresAt,
            paymentId
          );
        }
        return c.json<APIResponse<UnlockResponse>>({
          success: true,
          data: {
            secretKey: decrypt(stash.secret_key),
            blobUrl: decrypt(stash.blob_url),
            blobSha256: stash.blob_sha256 ?? undefined,
            fileName: decrypt(stash.file_name),
            previewSecret: decryptPreviewSecret(stash.preview_secret),
            claimToken,
          },
        });
      } else if (existingPayment.status === 'pending') {
        return c.json<APIResponse<never>>(
          {
            success: false,
            error: 'Payment is processing, please wait',
          },
          409
        );
      } else {
        return c.json<APIResponse<never>>(
          {
            success: false,
            error: 'Previous payment failed, try with a new token',
          },
          400
        );
      }
    }

    // Create pending payment record
    db.prepare(
      `
      INSERT INTO payments (id, stash_id, status, token_hash)
      VALUES (?, ?, 'pending', ?)
    `
    ).run(paymentId, stashId, tokenHash);

    // Verify and swap the token
    const swapResult = await verifyAndSwapToken(body.token, stash.price_sats);

    if (!swapResult.success) {
      // Mark payment as failed
      db.prepare(`UPDATE payments SET status = 'failed' WHERE id = ?`).run(paymentId);
      return c.json<APIResponse<never>>(
        {
          success: false,
          error: 'Token verification failed',
        },
        400
      );
    }

    // Mark payment as successful and store seller token
    if (!swapResult.sellerToken) {
      db.prepare(`UPDATE payments SET status = 'failed' WHERE id = ?`).run(paymentId);
      return c.json<APIResponse<never>>(
        { success: false, error: 'Token swap succeeded but no seller token was returned' },
        500
      );
    }

    const claimToken = randomBytes(32).toString('hex');
    const claimExpiresAt = Math.floor(Date.now() / 1000) + 3600; // 1hr

    db.prepare(
      `
      UPDATE payments
      SET status = 'paid', seller_token = ?, claim_token = ?, claim_expires_at = ?, paid_at = unixepoch()
      WHERE id = ?
    `
    ).run(encrypt(swapResult.sellerToken), claimToken, claimExpiresAt, paymentId);

    // Trigger auto-settlement check (fire-and-forget)
    tryAutoSettle(stash.seller_pubkey).catch((err) =>
      console.error('Auto-settle failed:', err instanceof Error ? err.message : err)
    );

    // Return the secret key and blob URL
    return c.json<APIResponse<UnlockResponse>>({
      success: true,
      data: {
        secretKey: decrypt(stash.secret_key),
        blobUrl: decrypt(stash.blob_url),
        blobSha256: stash.blob_sha256 ?? undefined,
        fileName: decrypt(stash.file_name),
        previewSecret: decryptPreviewSecret(stash.preview_secret),
        claimToken,
      },
    });
  } catch (error) {
    console.error('Error unlocking stash:', error);
    return c.json<APIResponse<never>>(
      {
        success: false,
        error: 'Failed to process unlock',
      },
      500
    );
  }
});

// GET /api/unlock/:id/claim?token=xxx - Re-download with a claim token
unlockRoutes.get('/:id/claim', rateLimit(60_000, 10, '/api/unlock/claim'), async (c) => {
  const stashId = c.req.param('id');
  const claimToken = c.req.query('token');

  if (!claimToken || !/^[0-9a-f]{64}$/.test(claimToken)) {
    return c.json<APIResponse<never>>(
      { success: false, error: 'Missing or invalid claim token' },
      400
    );
  }

  const payment = db
    .prepare(
      `SELECT claim_expires_at FROM payments WHERE stash_id = ? AND claim_token = ? AND status = 'paid'`
    )
    .get(stashId, claimToken) as Pick<PaymentRow, 'claim_expires_at'> | null;

  if (!payment) {
    return c.json<APIResponse<never>>({ success: false, error: 'Invalid claim token' }, 404);
  }

  if (!payment.claim_expires_at || payment.claim_expires_at < Math.floor(Date.now() / 1000)) {
    return c.json<APIResponse<never>>({ success: false, error: 'Claim token has expired' }, 410);
  }

  const stash = db
    .prepare(
      'SELECT secret_key, blob_url, blob_sha256, preview_secret, file_name FROM stashes WHERE id = ?'
    )
    .get(stashId) as Pick<
    StashRow,
    'secret_key' | 'blob_url' | 'blob_sha256' | 'preview_secret' | 'file_name'
  > | null;

  if (!stash) {
    return c.json<APIResponse<never>>({ success: false, error: 'Stash not found' }, 404);
  }

  return c.json<APIResponse<UnlockResponse>>({
    success: true,
    data: {
      secretKey: decrypt(stash.secret_key),
      blobUrl: decrypt(stash.blob_url),
      blobSha256: stash.blob_sha256 ?? undefined,
      fileName: decrypt(stash.file_name),
      previewSecret: decryptPreviewSecret(stash.preview_secret),
    },
  });
});
