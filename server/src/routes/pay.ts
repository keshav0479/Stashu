import { Hono } from 'hono';
import db from '../db/index.js';
import {
  createPaymentInvoice,
  checkPaymentStatus,
  mintAfterPayment,
  verifyAndSwapToken,
} from '../lib/cashu.js';
import { encrypt } from '../lib/encryption.js';
import type { PayInvoiceResponse, PayStatusResponse, APIResponse } from '../../../shared/types.js';
import { tryAutoSettle } from '../lib/autosettle.js';

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
    const existingPayment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;

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
        .prepare('SELECT secret_key, blob_url, file_name FROM stashes WHERE id = ?')
        .get(stashId) as any;

      return c.json<APIResponse<PayStatusResponse>>({
        success: true,
        data: {
          paid: true,
          secretKey: stash.secret_key,
          blobUrl: stash.blob_url,
          fileName: stash.file_name,
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
      const current = db.prepare('SELECT status FROM payments WHERE id = ?').get(paymentId) as any;

      if (current?.status === 'paid') {
        const stash = db
          .prepare('SELECT secret_key, blob_url, file_name FROM stashes WHERE id = ?')
          .get(stashId) as any;
        return c.json<APIResponse<PayStatusResponse>>({
          success: true,
          data: {
            paid: true,
            secretKey: stash.secret_key,
            blobUrl: stash.blob_url,
            fileName: stash.file_name,
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
        'SELECT id, price_sats, secret_key, blob_url, file_name, seller_pubkey FROM stashes WHERE id = ?'
      )
      .get(stashId) as any;

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

      db.prepare(
        `UPDATE payments SET status = 'paid', seller_token = ?, paid_at = unixepoch() WHERE id = ?`
      ).run(encrypt(swapResult.sellerToken), paymentId);

      // Trigger auto-settlement check (fire-and-forget)
      tryAutoSettle(stash.seller_pubkey).catch(() => {});

      return c.json<APIResponse<PayStatusResponse>>({
        success: true,
        data: {
          paid: true,
          secretKey: stash.secret_key,
          blobUrl: stash.blob_url,
          fileName: stash.file_name,
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
