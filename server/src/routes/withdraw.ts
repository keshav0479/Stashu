import { Hono } from 'hono';
import db from '../db/index.js';
import { getMeltQuote, meltToLightning } from '../lib/cashu.js';
import type {
  WithdrawQuoteRequest,
  WithdrawQuoteResponse,
  WithdrawRequest,
  WithdrawResponse,
  APIResponse,
} from '../../../shared/types.js';

export const withdrawRoutes = new Hono();

// POST /api/withdraw/quote - Get fee estimate for Lightning withdrawal
withdrawRoutes.post('/quote', async (c) => {
  try {
    const body = await c.req.json<WithdrawQuoteRequest>();

    if (!body.pubkey || !body.invoice) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'pubkey and invoice are required' },
        400
      );
    }

    // Get unclaimed tokens for this seller
    const tokens = db
      .prepare(
        `
      SELECT p.seller_token, s.price_sats
      FROM payments p
      JOIN stashes s ON p.stash_id = s.id
      WHERE s.seller_pubkey = ? AND p.status = 'paid' AND p.seller_token IS NOT NULL AND p.claimed = 0
    `
      )
      .all(body.pubkey) as Array<{ seller_token: string; price_sats: number }>;

    if (tokens.length === 0) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'No unclaimed earnings to withdraw' },
        400
      );
    }

    const totalSats = tokens.reduce((sum, t) => sum + t.price_sats, 0);

    // Get fee estimate from mint
    const quoteResult = await getMeltQuote(body.invoice);
    if (!quoteResult.success) {
      return c.json<APIResponse<never>>(
        { success: false, error: quoteResult.error || 'Failed to get fee estimate' },
        400
      );
    }

    const feeSats = quoteResult.feeSats || 0;

    return c.json<APIResponse<WithdrawQuoteResponse>>({
      success: true,
      data: {
        totalSats,
        feeSats,
        netSats: totalSats - feeSats,
      },
    });
  } catch (error) {
    console.error('Error getting withdraw quote:', error);
    return c.json<APIResponse<never>>(
      { success: false, error: 'Failed to get withdrawal quote' },
      500
    );
  }
});

// POST /api/withdraw/execute - Execute Lightning withdrawal
withdrawRoutes.post('/execute', async (c) => {
  try {
    const body = await c.req.json<WithdrawRequest>();

    if (!body.pubkey || !body.invoice) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'pubkey and invoice are required' },
        400
      );
    }

    // Get unclaimed tokens for this seller
    const tokenRows = db
      .prepare(
        `
      SELECT p.id as payment_id, p.seller_token, s.price_sats
      FROM payments p
      JOIN stashes s ON p.stash_id = s.id
      WHERE s.seller_pubkey = ? AND p.status = 'paid' AND p.seller_token IS NOT NULL AND p.claimed = 0
    `
      )
      .all(body.pubkey) as Array<{
      payment_id: string;
      seller_token: string;
      price_sats: number;
    }>;

    if (tokenRows.length === 0) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'No unclaimed earnings to withdraw' },
        400
      );
    }

    const tokens = tokenRows.map((r) => r.seller_token);
    const paymentIds = tokenRows.map((r) => r.payment_id);

    // Melt tokens to Lightning
    const meltResult = await meltToLightning(tokens, body.invoice);

    if (!meltResult.success) {
      return c.json<APIResponse<never>>(
        { success: false, error: meltResult.error || 'Lightning withdrawal failed' },
        400
      );
    }

    // Mark all tokens as claimed
    const markClaimed = db.prepare(`UPDATE payments SET claimed = 1 WHERE id = ?`);
    const markAll = db.transaction(() => {
      for (const id of paymentIds) {
        markClaimed.run(id);
      }
    });
    markAll();

    return c.json<APIResponse<WithdrawResponse>>({
      success: true,
      data: {
        paid: true,
        feeSats: meltResult.feeSats || 0,
        preimage: meltResult.preimage || '',
      },
    });
  } catch (error) {
    console.error('Error executing withdrawal:', error);
    return c.json<APIResponse<never>>({ success: false, error: 'Withdrawal failed' }, 500);
  }
});
