import { Hono } from 'hono';
import db from '../db/index.js';
import type { EarningsResponse, APIResponse } from '../../../shared/types.js';

export const earningsRoutes = new Hono();

// GET /api/earnings/:pubkey - Get unclaimed tokens for a seller
earningsRoutes.get('/:pubkey', async (c) => {
  try {
    const pubkey = c.req.param('pubkey');

    // Get all paid payments for stashes owned by this seller
    const stmt = db.prepare(`
      SELECT p.seller_token, s.price_sats
      FROM payments p
      JOIN stashes s ON p.stash_id = s.id
      WHERE s.seller_pubkey = ? AND p.status = 'paid' AND p.seller_token IS NOT NULL AND p.claimed = 0
    `);

    const results = stmt.all(pubkey) as Array<{ seller_token: string; price_sats: number }>;

    const tokens = results.map((r) => r.seller_token);
    const totalSats = results.reduce((sum, r) => sum + r.price_sats, 0);

    return c.json<APIResponse<EarningsResponse>>({
      success: true,
      data: { tokens, totalSats },
    });
  } catch (error) {
    console.error('Error fetching earnings:', error);
    return c.json<APIResponse<never>>(
      {
        success: false,
        error: 'Failed to fetch earnings',
      },
      500
    );
  }
});
