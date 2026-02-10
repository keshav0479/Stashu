import { Hono } from 'hono';
import db from '../db/index.js';
import {
  createPaymentInvoice,
  checkPaymentStatus,
  mintAfterPayment,
  verifyAndSwapToken,
} from '../lib/cashu.js';
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

    // Check if we already processed this quote (idempotency)
    const existingPayment = db
      .prepare('SELECT * FROM payments WHERE id = ?')
      .get(`ln-${quoteId}`) as any;

    if (existingPayment?.status === 'paid') {
      // Already processed — return the unlock data
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

    // Payment confirmed! Get stash details
    const stash = db
      .prepare('SELECT id, price_sats, secret_key, blob_url, file_name FROM stashes WHERE id = ?')
      .get(stashId) as any;

    if (!stash) {
      return c.json<APIResponse<never>>({ success: false, error: 'Stash not found' }, 404);
    }

    // Create pending payment record (use ln- prefix for Lightning payments)
    const paymentId = `ln-${quoteId}`;
    try {
      db.prepare(
        `INSERT INTO payments (id, stash_id, status, token_hash) VALUES (?, ?, 'pending', ?)`
      ).run(paymentId, stashId, quoteId);
    } catch {
      // Payment record might already exist from a concurrent request
      const existing = db.prepare('SELECT status FROM payments WHERE id = ?').get(paymentId) as any;
      if (existing?.status === 'paid') {
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
      db.prepare(
        `UPDATE payments SET status = 'paid', seller_token = ?, paid_at = unixepoch() WHERE id = ?`
      ).run(swapResult.sellerToken, paymentId);

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
