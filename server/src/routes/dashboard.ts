import { Hono } from 'hono';
import db from '../db/index.js';
import type {
  DashboardResponse,
  SellerStashStats,
  SettlementLogEntry,
  APIResponse,
} from '../../../shared/types.js';

export const dashboardRoutes = new Hono();

dashboardRoutes.get('/:pubkey', async (c) => {
  try {
    const pubkey = c.req.param('pubkey');

    const stashesStmt = db.prepare(`
      SELECT 
        s.id,
        s.title,
        s.price_sats,
        s.created_at,
        COUNT(CASE WHEN p.status = 'paid' THEN 1 END) as unlock_count,
        COALESCE(SUM(CASE WHEN p.status = 'paid' THEN s.price_sats ELSE 0 END), 0) as total_earned
      FROM stashes s
      LEFT JOIN payments p ON s.id = p.stash_id
      WHERE s.seller_pubkey = ?
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `);

    const stashRows = stashesStmt.all(pubkey) as Array<{
      id: string;
      title: string;
      price_sats: number;
      created_at: number;
      unlock_count: number;
      total_earned: number;
    }>;

    const stashes: SellerStashStats[] = stashRows.map((row) => ({
      id: row.id,
      title: row.title,
      priceSats: row.price_sats,
      unlockCount: row.unlock_count,
      totalEarned: row.total_earned,
      createdAt: row.created_at,
    }));

    const tokensStmt = db.prepare(`
      SELECT p.seller_token, s.price_sats
      FROM payments p
      JOIN stashes s ON p.stash_id = s.id
      WHERE s.seller_pubkey = ? AND p.status = 'paid' AND p.seller_token IS NOT NULL AND p.claimed = 0
    `);

    const tokenRows = tokensStmt.all(pubkey) as Array<{
      seller_token: string;
      price_sats: number;
    }>;

    const tokens = tokenRows.map((r) => r.seller_token);
    const totalSats = tokenRows.reduce((sum, r) => sum + r.price_sats, 0);

    return c.json<APIResponse<DashboardResponse>>({
      success: true,
      data: {
        stashes,
        earnings: { tokens, totalSats },
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    return c.json<APIResponse<never>>(
      {
        success: false,
        error: 'Failed to fetch dashboard data',
      },
      500
    );
  }
});

// GET /api/dashboard/:pubkey/settlements — Settlement history
dashboardRoutes.get('/:pubkey/settlements', async (c) => {
  try {
    const pubkey = c.req.param('pubkey');

    const rows = db
      .prepare(
        `SELECT id, status, amount_sats, fee_sats, net_sats, ln_address, error, created_at
         FROM settlement_log
         WHERE seller_pubkey = ?
         ORDER BY created_at DESC
         LIMIT 20`
      )
      .all(pubkey) as Array<{
      id: number;
      status: string;
      amount_sats: number | null;
      fee_sats: number | null;
      net_sats: number | null;
      ln_address: string | null;
      error: string | null;
      created_at: number;
    }>;

    const entries: SettlementLogEntry[] = rows.map((r) => ({
      id: r.id,
      status: r.status as SettlementLogEntry['status'],
      amountSats: r.amount_sats,
      feeSats: r.fee_sats,
      netSats: r.net_sats,
      lnAddress: r.ln_address,
      error: r.error,
      createdAt: r.created_at,
    }));

    return c.json<APIResponse<SettlementLogEntry[]>>({
      success: true,
      data: entries,
    });
  } catch (error) {
    console.error('Error fetching settlements:', error);
    return c.json<APIResponse<never>>(
      { success: false, error: 'Failed to fetch settlement history' },
      500
    );
  }
});
