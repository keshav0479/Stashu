import { Hono } from 'hono';
import { createHash } from 'crypto';
import db from '../db/index.js';
import { verifyAndSwapToken } from '../lib/cashu.js';
import { tryAutoSettle } from '../lib/autosettle.js';
import type { UnlockRequest, UnlockResponse, APIResponse } from '../../../shared/types.js';

export const unlockRoutes = new Hono();

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
      SELECT id, blob_url, secret_key, file_name, price_sats, seller_pubkey 
      FROM stashes WHERE id = ?
    `);
    const stash = stashStmt.get(stashId) as any;

    if (!stash) {
      return c.json<APIResponse<never>>(
        {
          success: false,
          error: 'Stash not found',
        },
        404
      );
    }

    // Create payment ID from token hash (for idempotency)
    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    const paymentId = `${stashId}-${tokenHash.slice(0, 16)}`;

    // Check if payment already exists
    const existingPayment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;

    if (existingPayment) {
      if (existingPayment.status === 'paid') {
        // Already paid - return the key (idempotent)
        return c.json<APIResponse<UnlockResponse>>({
          success: true,
          data: {
            secretKey: stash.secret_key,
            blobUrl: stash.blob_url,
            fileName: stash.file_name,
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
          error: swapResult.error || 'Token verification failed',
        },
        400
      );
    }

    // Mark payment as successful and store seller token
    db.prepare(
      `
      UPDATE payments 
      SET status = 'paid', seller_token = ?, paid_at = unixepoch()
      WHERE id = ?
    `
    ).run(swapResult.sellerToken, paymentId);

    // Trigger auto-settlement check (fire-and-forget)
    tryAutoSettle(stash.seller_pubkey).catch(() => {});

    // Return the secret key and blob URL
    return c.json<APIResponse<UnlockResponse>>({
      success: true,
      data: {
        secretKey: stash.secret_key,
        blobUrl: stash.blob_url,
        fileName: stash.file_name,
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
