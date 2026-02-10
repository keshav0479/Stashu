import { Hono } from 'hono';
import db from '../db/index.js';
import { getMeltQuote, meltToLightning } from '../lib/cashu.js';
import { resolveAddress } from '../lib/lnaddress.js';
import type { AuthVariables } from '../middleware/auth.js';
import type {
  WithdrawQuoteResponse,
  WithdrawResponse,
  LnAddressResolveRequest,
  LnAddressResolveResponse,
  APIResponse,
} from '../../../shared/types.js';

export const withdrawRoutes = new Hono<{ Variables: AuthVariables }>();

// POST /api/withdraw/quote - Get fee estimate for Lightning withdrawal
withdrawRoutes.post('/quote', async (c) => {
  try {
    const pubkey = c.get('authedPubkey');
    const body = await c.req.json<{ invoice: string }>();

    if (!body.invoice) {
      return c.json<APIResponse<never>>({ success: false, error: 'invoice is required' }, 400);
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
      .all(pubkey) as Array<{ seller_token: string; price_sats: number }>;

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
    const invoiceAmountSats = quoteResult.amountSats || 0;

    return c.json<APIResponse<WithdrawQuoteResponse>>({
      success: true,
      data: {
        totalSats,
        feeSats,
        netSats: totalSats - feeSats,
        invoiceAmountSats,
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
    const pubkey = c.get('authedPubkey');
    const body = await c.req.json<{ invoice: string }>();

    if (!body.invoice) {
      return c.json<APIResponse<never>>({ success: false, error: 'invoice is required' }, 400);
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
      .all(pubkey) as Array<{
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
    const totalSats = tokenRows.reduce((sum, r) => sum + r.price_sats, 0);

    // Melt tokens to Lightning
    const meltResult = await meltToLightning(tokens, body.invoice);

    if (!meltResult.success) {
      // Log failed manual withdrawal
      db.prepare(
        `INSERT INTO settlement_log (seller_pubkey, status, amount_sats, error)
         VALUES (?, 'failed', ?, ?)`
      ).run(pubkey, totalSats, meltResult.error || 'Lightning withdrawal failed');

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

    // Log successful manual withdrawal
    const feeSats = meltResult.feeSats || 0;
    const netSats = totalSats - feeSats;
    db.prepare(
      `INSERT INTO settlement_log (seller_pubkey, status, amount_sats, fee_sats, net_sats)
       VALUES (?, 'success', ?, ?, ?)`
    ).run(pubkey, totalSats, feeSats, netSats);

    return c.json<APIResponse<WithdrawResponse>>({
      success: true,
      data: {
        paid: true,
        feeSats,
        preimage: meltResult.preimage || '',
      },
    });
  } catch (error) {
    console.error('Error executing withdrawal:', error);
    return c.json<APIResponse<never>>({ success: false, error: 'Withdrawal failed' }, 500);
  }
});

// POST /api/withdraw/resolve-address - Resolve a Lightning address to a BOLT11 invoice
withdrawRoutes.post('/resolve-address', async (c) => {
  try {
    const body = await c.req.json<LnAddressResolveRequest>();

    if (!body.address || !body.amountSats) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'address and amountSats are required' },
        400
      );
    }

    // Check if it's a Lightning address format (user@domain)
    if (!body.address.includes('@')) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'Invalid Lightning address format. Expected user@domain.com' },
        400
      );
    }

    const invoice = await resolveAddress(body.address, body.amountSats);

    return c.json<APIResponse<LnAddressResolveResponse>>({
      success: true,
      data: { invoice },
    });
  } catch (error) {
    console.error('Error resolving Lightning address:', error);
    return c.json<APIResponse<never>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve Lightning address',
      },
      400
    );
  }
});
