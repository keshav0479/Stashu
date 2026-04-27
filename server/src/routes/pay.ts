import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import db from '../db/index.js';
import {
  createPaymentInvoice,
  checkPaymentStatus,
  mintAfterPayment,
  verifyAndSwapToken,
} from '../lib/cashu.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import type {
  PayInvoiceResponse,
  PayStatusResponse,
  StashProofSecret,
  APIResponse,
} from '../../../shared/types.js';
import type { StashRow, PaymentRow } from '../db/types.js';
import { tryAutoSettle } from '../lib/autosettle.js';

function ensureClaimToken(
  payment: Pick<PaymentRow, 'claim_token' | 'claim_expires_at'>,
  paymentId: string
): string {
  const now = Math.floor(Date.now() / 1000);
  if (payment.claim_token && payment.claim_expires_at && payment.claim_expires_at >= now) {
    return payment.claim_token;
  }
  const claimToken = randomBytes(32).toString('hex');
  const claimExpiresAt = now + 3600;
  db.prepare(`UPDATE payments SET claim_token = ?, claim_expires_at = ? WHERE id = ?`).run(
    claimToken,
    claimExpiresAt,
    paymentId
  );
  return claimToken;
}

function decryptPreviewSecret(value: string | null): StashProofSecret | undefined {
  return value ? (JSON.parse(decrypt(value)) as StashProofSecret) : undefined;
}

export const payRoutes = new Hono();

// POST /api/pay/:id/invoice — Create a Lightning invoice for a stash
payRoutes.post('/:id/invoice', async (c) => {
  try {
    const stashId = c.req.param('id');

    // Get stash
    const stash = db.prepare('SELECT id, price_sats FROM stashes WHERE id = ?').get(stashId) as
      | { id: string; price_sats: number }
      | undefined;

    if (!stash) {
      return c.json<APIResponse<never>>({ success: false, error: 'Stash not found' }, 404);
    }

    // Create a Lightning invoice via the Cashu mint
    const { invoice, quoteId, expiresAt } = await createPaymentInvoice(stash.price_sats);

    // Bind quoteId → stashId immediately (prevents cross-stash replay)
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash) VALUES (?, ?, 'pending', ?)`
    ).run(`ln-${quoteId}`, stashId, quoteId);

    return c.json<APIResponse<PayInvoiceResponse>>({
      success: true,
      data: {
        invoice,
        quoteId,
        amountSats: stash.price_sats,
        expiresAt,
      },
    });
  } catch (error) {
    console.error('Error creating payment invoice:', error);
    return c.json<APIResponse<never>>({ success: false, error: 'Failed to create invoice' }, 500);
  }
});

// GET /api/pay/:id/status/:quoteId — Poll payment status
// When paid: mint tokens → swap → store seller token → return unlock data
payRoutes.get('/:id/status/:quoteId', async (c) => {
  try {
    const stashId = c.req.param('id');
    const quoteId = c.req.param('quoteId');
    const paymentId = `ln-${quoteId}`;

    // Look up the quote binding (created at invoice time)
    const existingPayment = db
      .prepare('SELECT * FROM payments WHERE id = ?')
      .get(paymentId) as PaymentRow | null;

    // Reject if no binding exists (quote was not created through our API)
    if (!existingPayment) {
      return c.json<APIResponse<never>>({ success: false, error: 'Unknown quote' }, 404);
    }

    // Enforce quoteId → stashId binding (anti-replay, checked on EVERY poll)
    if (existingPayment.stash_id !== stashId) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'Quote does not match this stash' },
        403
      );
    }

    // Already processed — return the unlock data
    if (existingPayment.status === 'paid') {
      const stash = db
        .prepare(
          'SELECT secret_key, blob_url, blob_sha256, preview_secret, file_name FROM stashes WHERE id = ?'
        )
        .get(stashId) as Pick<
        StashRow,
        'secret_key' | 'blob_url' | 'blob_sha256' | 'preview_secret' | 'file_name'
      >;

      const claimToken = ensureClaimToken(existingPayment, paymentId);

      return c.json<APIResponse<PayStatusResponse>>({
        success: true,
        data: {
          paid: true,
          secretKey: decrypt(stash.secret_key),
          blobUrl: decrypt(stash.blob_url),
          blobSha256: stash.blob_sha256 ?? undefined,
          fileName: decrypt(stash.file_name),
          previewSecret: decryptPreviewSecret(stash.preview_secret),
          claimToken,
        },
      });
    }

    // Check payment status with the mint
    const status = await checkPaymentStatus(quoteId);

    if (!status.paid) {
      return c.json<APIResponse<PayStatusResponse>>({
        success: true,
        data: { paid: false },
      });
    }

    // Payment confirmed! Atomically claim processing rights (prevents race condition)
    const claimed = db
      .prepare(`UPDATE payments SET status = 'processing' WHERE id = ? AND status = 'pending'`)
      .run(paymentId);

    if (claimed.changes === 0) {
      // Another request is already processing or has completed — re-check status
      const current = db.prepare('SELECT status FROM payments WHERE id = ?').get(paymentId) as Pick<
        PaymentRow,
        'status'
      > | null;

      if (current?.status === 'paid') {
        const stash = db
          .prepare(
            'SELECT secret_key, blob_url, blob_sha256, preview_secret, file_name FROM stashes WHERE id = ?'
          )
          .get(stashId) as Pick<
          StashRow,
          'secret_key' | 'blob_url' | 'blob_sha256' | 'preview_secret' | 'file_name'
        >;

        const paidRow = db
          .prepare('SELECT claim_token, claim_expires_at FROM payments WHERE id = ?')
          .get(paymentId) as Pick<PaymentRow, 'claim_token' | 'claim_expires_at'>;
        const claimToken = ensureClaimToken(
          paidRow ?? { claim_token: null, claim_expires_at: null },
          paymentId
        );

        return c.json<APIResponse<PayStatusResponse>>({
          success: true,
          data: {
            paid: true,
            secretKey: decrypt(stash.secret_key),
            blobUrl: decrypt(stash.blob_url),
            blobSha256: stash.blob_sha256 ?? undefined,
            fileName: decrypt(stash.file_name),
            previewSecret: decryptPreviewSecret(stash.preview_secret),
            claimToken,
          },
        });
      }

      if (current?.status === 'failed' || current?.status === 'mint_failed') {
        return c.json<APIResponse<never>>(
          {
            success: false,
            error: 'Payment processing failed. Please try again with a new invoice.',
          },
          500
        );
      }

      // Still processing — tell client to keep polling
      return c.json<APIResponse<PayStatusResponse>>({
        success: true,
        data: { paid: false },
      });
    }

    const stash = db
      .prepare(
        'SELECT id, price_sats, secret_key, blob_url, blob_sha256, preview_secret, file_name, seller_pubkey FROM stashes WHERE id = ?'
      )
      .get(stashId) as Pick<
      StashRow,
      | 'id'
      | 'price_sats'
      | 'secret_key'
      | 'blob_url'
      | 'blob_sha256'
      | 'preview_secret'
      | 'file_name'
      | 'seller_pubkey'
    > | null;

    if (!stash) {
      return c.json<APIResponse<never>>({ success: false, error: 'Stash not found' }, 404);
    }

    try {
      // Mint tokens from the paid invoice
      const mintedToken = await mintAfterPayment(stash.price_sats, quoteId);

      // Swap minted tokens to create seller's token
      const swapResult = await verifyAndSwapToken(mintedToken, stash.price_sats);

      if (!swapResult.success) {
        db.prepare(`UPDATE payments SET status = 'failed' WHERE id = ?`).run(paymentId);
        return c.json<APIResponse<never>>(
          { success: false, error: 'Token swap failed after payment' },
          500
        );
      }

      // Store successful payment
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
        `UPDATE payments SET status = 'paid', seller_token = ?, claim_token = ?, claim_expires_at = ?, paid_at = unixepoch() WHERE id = ?`
      ).run(encrypt(swapResult.sellerToken), claimToken, claimExpiresAt, paymentId);

      // Trigger auto-settlement check (fire-and-forget)
      tryAutoSettle(stash.seller_pubkey).catch((err) =>
        console.error('Auto-settle failed:', err instanceof Error ? err.message : err)
      );

      return c.json<APIResponse<PayStatusResponse>>({
        success: true,
        data: {
          paid: true,
          secretKey: decrypt(stash.secret_key),
          blobUrl: decrypt(stash.blob_url),
          blobSha256: stash.blob_sha256 ?? undefined,
          fileName: decrypt(stash.file_name),
          previewSecret: decryptPreviewSecret(stash.preview_secret),
          claimToken,
        },
      });
    } catch (mintError) {
      console.error('Error minting/swapping after payment:', mintError);
      // Store quoteId so we can retry minting later (recovery)
      db.prepare(`UPDATE payments SET status = 'mint_failed', token_hash = ? WHERE id = ?`).run(
        quoteId,
        paymentId
      );
      return c.json<APIResponse<never>>(
        { success: false, error: 'Payment received but token processing failed. Contact support.' },
        500
      );
    }
  } catch (error) {
    console.error('Error checking payment status:', error);
    return c.json<APIResponse<never>>(
      { success: false, error: 'Failed to check payment status' },
      500
    );
  }
});
