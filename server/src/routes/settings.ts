import { Hono } from 'hono';
import db from '../db/index.js';
import { tryAutoSettle } from '../lib/autosettle.js';
import type { SellerSettings, APIResponse } from '../../../shared/types.js';

export const settingsRoutes = new Hono();

// GET /api/settings/:pubkey — Get seller's auto-settlement settings
settingsRoutes.get('/:pubkey', async (c) => {
  try {
    const pubkey = c.req.param('pubkey');

    const row = db
      .prepare('SELECT ln_address, auto_withdraw_threshold FROM seller_settings WHERE pubkey = ?')
      .get(pubkey) as { ln_address: string | null; auto_withdraw_threshold: number } | undefined;

    const settings: SellerSettings = {
      lnAddress: row?.ln_address || '',
      autoWithdrawThreshold: row?.auto_withdraw_threshold || 0,
    };

    return c.json<APIResponse<SellerSettings>>({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return c.json<APIResponse<never>>({ success: false, error: 'Failed to fetch settings' }, 500);
  }
});

// POST /api/settings/:pubkey — Save seller's auto-settlement settings
settingsRoutes.post('/:pubkey', async (c) => {
  try {
    const pubkey = c.req.param('pubkey');
    const body = await c.req.json<SellerSettings>();

    // Validate Lightning address format if provided
    if (body.lnAddress && (!body.lnAddress.includes('@') || !body.lnAddress.includes('.'))) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'Invalid Lightning address format. Expected user@domain.com' },
        400
      );
    }

    // Validate threshold
    const threshold = Math.max(0, Math.floor(body.autoWithdrawThreshold || 0));

    db.prepare(
      `INSERT INTO seller_settings (pubkey, ln_address, auto_withdraw_threshold, updated_at)
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(pubkey) DO UPDATE SET
         ln_address = excluded.ln_address,
         auto_withdraw_threshold = excluded.auto_withdraw_threshold,
         updated_at = unixepoch()`
    ).run(pubkey, body.lnAddress || null, threshold);

    // Trigger auto-settlement for any existing unclaimed balance
    tryAutoSettle(pubkey).catch(() => {});

    return c.json<APIResponse<SellerSettings>>({
      success: true,
      data: {
        lnAddress: body.lnAddress || '',
        autoWithdrawThreshold: threshold,
      },
    });
  } catch (error) {
    console.error('Error saving settings:', error);
    return c.json<APIResponse<never>>({ success: false, error: 'Failed to save settings' }, 500);
  }
});
