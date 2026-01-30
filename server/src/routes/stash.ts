import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/index.js';
import type { CreateStashRequest, CreateStashResponse, StashPublicInfo, APIResponse } from '../../../shared/types.js';

export const stashRoutes = new Hono();

// POST /api/stash - Create a new stash
stashRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json<CreateStashRequest>();
    
    // Validate required fields
    if (!body.blobUrl || !body.secretKey || !body.sellerPubkey || !body.priceSats || !body.title || !body.fileSize) {
      return c.json<APIResponse<never>>({ 
        success: false, 
        error: 'Missing required fields' 
      }, 400);
    }

    const id = uuidv4();
    
    const stmt = db.prepare(`
      INSERT INTO stashes (id, blob_url, secret_key, key_backup, seller_pubkey, price_sats, title, description, file_size, preview_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      body.blobUrl,
      body.secretKey,
      body.keyBackup || null,
      body.sellerPubkey,
      body.priceSats,
      body.title,
      body.description || null,
      body.fileSize,
      body.previewUrl || null
    );

    const shareUrl = `/s/${id}`;

    return c.json<APIResponse<CreateStashResponse>>({
      success: true,
      data: { id, shareUrl }
    }, 201);

  } catch (error) {
    console.error('Error creating stash:', error);
    return c.json<APIResponse<never>>({ 
      success: false, 
      error: 'Failed to create stash' 
    }, 500);
  }
});

// GET /api/stash/:id - Get public stash info
stashRoutes.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    
    const stmt = db.prepare(`
      SELECT id, title, description, file_size, price_sats, preview_url
      FROM stashes WHERE id = ?
    `);
    
    const stash = stmt.get(id) as StashPublicInfo | undefined;

    if (!stash) {
      return c.json<APIResponse<never>>({ 
        success: false, 
        error: 'Stash not found' 
      }, 404);
    }

    // Convert snake_case to camelCase
    const response: StashPublicInfo = {
      id: stash.id,
      title: stash.title,
      description: stash.description,
      fileSize: (stash as any).file_size,
      priceSats: (stash as any).price_sats,
      previewUrl: (stash as any).preview_url,
    };

    return c.json<APIResponse<StashPublicInfo>>({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('Error fetching stash:', error);
    return c.json<APIResponse<never>>({ 
      success: false, 
      error: 'Failed to fetch stash' 
    }, 500);
  }
});
