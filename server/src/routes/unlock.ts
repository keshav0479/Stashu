import { Hono } from 'hono';
import { createHash, randomBytes } from 'crypto';
import db, { STASH_FOR_SALE_SQL } from '../db/index.js';
import { getMaxMintAmount, getTokenValuation, verifyAndSwapToken } from '../lib/cashu.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { tryAutoSettle } from '../lib/autosettle.js';
import { resolvePaymentAmount } from '../lib/pricing.js';
import { rateLimit } from '../middleware/ratelimit.js';
import type {
  StashProofSecret,
  UnlockRequest,
  UnlockResponse,
  APIResponse,
} from '../../../shared/types.js';
import { DEFAULT_DOWNLOAD_WINDOW_SECONDS } from '../../../shared/types.js';
import type { StashRow, PaymentRow } from '../db/types.js';

export const unlockRoutes = new Hono();

function decryptPreviewSecret(value: string | null): StashProofSecret | undefined {
  return value ? (JSON.parse(decrypt(value)) as StashProofSecret) : undefined;
}

const STASH_DELETED_ERROR = 'This stash was deleted by its seller';
const STASH_UNPUBLISHED_ERROR = 'This stash is not for sale right now';

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
      SELECT id, blob_url, blob_sha256, secret_key, preview_secret, file_name, price_sats,
             pay_what_you_want, seller_pubkey, download_window_seconds, published, deleted_at
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
      | 'pay_what_you_want'
      | 'seller_pubkey'
      | 'download_window_seconds'
      | 'published'
      | 'deleted_at'
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
    if (stash.deleted_at !== null) {
      return c.json<APIResponse<never>>({ success: false, error: STASH_DELETED_ERROR }, 410);
    }

    const windowSeconds = stash.download_window_seconds ?? DEFAULT_DOWNLOAD_WINDOW_SECONDS;

    // Create payment ID from full token hash (for idempotency)
    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    const paymentId = `${stashId}-${tokenHash}`;

    // Check if payment already exists
    const existingPayment = db
      .prepare('SELECT * FROM payments WHERE id = ?')
      .get(paymentId) as PaymentRow | null;

    if (existingPayment) {
      if (existingPayment.status === 'paid') {
        // Already paid - return the key (idempotent). Regenerate the claim token if
        // missing/expired. NOTE: re-submitting the original payment token deliberately
        // grants a fresh window past expiry — proof-of-payment recovery, intentionally
        // softer than GET /claim's hard 410. Don't "fix" this mismatch.
        let claimToken = existingPayment.claim_token;
        let claimExpiresAt = existingPayment.claim_expires_at;
        const now = Math.floor(Date.now() / 1000);
        if (
          !claimToken ||
          !existingPayment.claim_expires_at ||
          existingPayment.claim_expires_at < now
        ) {
          claimToken = randomBytes(32).toString('hex');
          claimExpiresAt = now + windowSeconds;
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
            claimExpiresAt: claimExpiresAt ?? undefined,
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

    // Only new payments stop when a stash is unpublished. Re-sending a token
    // that already paid, above, still unlocks.
    if (stash.published !== 1) {
      return c.json<APIResponse<never>>({ success: false, error: STASH_UNPUBLISHED_ERROR }, 409);
    }

    // The price, or for pay-what-you-want the amount the buyer chose.
    const payWhatYouWant = stash.pay_what_you_want === 1;
    const amount = resolvePaymentAmount(
      stash,
      body.amountSats,
      payWhatYouWant ? await getMaxMintAmount() : null
    );
    if (!amount.ok) {
      return c.json<APIResponse<never>>({ success: false, error: amount.error }, 400);
    }
    const amountSats = amount.amountSats;

    // Reject tokens that would not credit exactly that amount before any swap:
    // overpayment is swept to the seller in full with no change path back to
    // the buyer — which is why pay-what-you-want asks the buyer to name the
    // amount rather than accepting any token above the minimum — and a token
    // netting less after mint input fees (NUT-02) would credit less than the
    // recorded earnings and break withdrawal.
    const valuation = await getTokenValuation(body.token);
    if (!valuation) {
      return c.json<APIResponse<never>>({ success: false, error: 'Invalid Cashu token' }, 400);
    }
    if (valuation.receivableSats !== amountSats) {
      const feeSats = valuation.valueSats - valuation.receivableSats;
      const target = payWhatYouWant ? 'you chose to pay' : 'the price is';
      const Target = payWhatYouWant ? 'You chose to pay' : 'The price is';
      return c.json<APIResponse<never>>(
        {
          success: false,
          error:
            feeSats > 0
              ? `Token is worth ${valuation.valueSats} sats but credits ${valuation.receivableSats} after the mint's ${feeSats}-sat receive fee. ${Target} ${amountSats}, send ${amountSats} sats plus the fee.`
              : `Token is worth ${valuation.valueSats} sats but ${target} ${amountSats}. Send exactly ${amountSats} sats.`,
        },
        400
      );
    }

    // Create pending payment record, with the amount it will credit. The
    // seller may have unpublished or deleted the stash while the mint was
    // valuing the token, so the insert re-checks in the same statement, and
    // the token is never swapped if it no longer applies.
    const recorded = db
      .prepare(
        `
      INSERT INTO payments (id, stash_id, status, token_hash, amount_sats)
      SELECT ?, ?, 'pending', ?, ?
      WHERE EXISTS (SELECT 1 FROM stashes WHERE id = ? AND ${STASH_FOR_SALE_SQL})
    `
      )
      .run(paymentId, stashId, tokenHash, amountSats, stashId);

    if (recorded.changes === 0) {
      return c.json<APIResponse<never>>({ success: false, error: STASH_UNPUBLISHED_ERROR }, 409);
    }

    // Verify and swap the token
    const swapResult = await verifyAndSwapToken(body.token, amountSats);

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
    const claimExpiresAt = Math.floor(Date.now() / 1000) + windowSeconds;

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
        claimExpiresAt,
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
      'SELECT secret_key, blob_url, blob_sha256, preview_secret, file_name, deleted_at FROM stashes WHERE id = ?'
    )
    .get(stashId) as Pick<
    StashRow,
    'secret_key' | 'blob_url' | 'blob_sha256' | 'preview_secret' | 'file_name' | 'deleted_at'
  > | null;

  if (!stash) {
    return c.json<APIResponse<never>>({ success: false, error: 'Stash not found' }, 404);
  }
  if (stash.deleted_at !== null) {
    return c.json<APIResponse<never>>({ success: false, error: STASH_DELETED_ERROR }, 404);
  }

  return c.json<APIResponse<UnlockResponse>>({
    success: true,
    data: {
      secretKey: decrypt(stash.secret_key),
      blobUrl: decrypt(stash.blob_url),
      blobSha256: stash.blob_sha256 ?? undefined,
      fileName: decrypt(stash.file_name),
      previewSecret: decryptPreviewSecret(stash.preview_secret),
      claimExpiresAt: payment.claim_expires_at,
    },
  });
});
