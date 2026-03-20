import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/index.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import type { AuthVariables } from '../middleware/auth.js';
import type {
  CreateStashRequest,
  CreateStashResponse,
  StashPublicInfo,
  APIResponse,
} from '../../../shared/types.js';
import type { StashRow } from '../db/types.js';

export const stashRoutes = new Hono<{ Variables: AuthVariables }>();

// POST /api/stash - Create a new stash (requires NIP-98 auth)
stashRoutes.post('/', async (c) => {
  try {
    const pubkey = c.get('authedPubkey');
    const body = await c.req.json<CreateStashRequest>();

    // Validate required fields
    if (!body.blobUrl || !body.secretKey || !body.title || !body.fileName) {
      return c.json<APIResponse<never>>({ success: false, error: 'Missing required fields' }, 400);
    }

    // Validate blobUrl is a valid URL
    try {
      new URL(body.blobUrl);
    } catch {
      return c.json<APIResponse<never>>({ success: false, error: 'Invalid blobUrl' }, 400);
    }

    // Validate price
    if (!Number.isInteger(body.priceSats) || body.priceSats < 1) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'priceSats must be a positive integer' },
        400
      );
    }

    // Validate file size (1 byte – 100 MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    if (!Number.isInteger(body.fileSize) || body.fileSize < 1 || body.fileSize > MAX_FILE_SIZE) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'fileSize must be between 1 and 104857600 bytes' },
        400
      );
    }

    // Validate text lengths
    if (body.title.length > 200) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'title exceeds 200 characters' },
        400
      );
    }
    if (body.description && body.description.length > 2000) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'description exceeds 2000 characters' },
        400
      );
    }

    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO stashes (id, blob_url, secret_key, seller_pubkey, price_sats, title, description, file_name, file_size, preview_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      body.blobUrl,
      encrypt(body.secretKey),
      pubkey, // Use authed pubkey, not body.sellerPubkey (prevents spoofing)
      body.priceSats,
      encrypt(body.title),
      body.description ? encrypt(body.description) : null,
      encrypt(body.fileName),
      body.fileSize,
      body.previewUrl || null
    );

    const shareUrl = `/s/${id}`;

    return c.json<APIResponse<CreateStashResponse>>(
      {
        success: true,
        data: { id, shareUrl },
      },
      201
    );
  } catch (error) {
    console.error('Error creating stash:', error);
    return c.json<APIResponse<never>>(
      {
        success: false,
        error: 'Failed to create stash',
      },
      500
    );
  }
});

// GET /api/stash/:id - Get public stash info
stashRoutes.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const stmt = db.prepare(`
      SELECT id, title, description, file_name, file_size, price_sats, preview_url
      FROM stashes WHERE id = ?
    `);

    const stash = stmt.get(id) as Pick<
      StashRow,
      'id' | 'title' | 'description' | 'file_name' | 'file_size' | 'price_sats' | 'preview_url'
    > | null;

    if (!stash) {
      return c.json<APIResponse<never>>(
        {
          success: false,
          error: 'Stash not found',
        },
        404
      );
    }

    // Convert snake_case to camelCase and decrypt metadata
    const response: StashPublicInfo = {
      id: stash.id,
      title: decrypt(stash.title),
      description: stash.description ? decrypt(stash.description) : undefined,
      fileName: decrypt(stash.file_name),
      fileSize: stash.file_size,
      priceSats: stash.price_sats,
      previewUrl: stash.preview_url ?? undefined,
    };

    return c.json<APIResponse<StashPublicInfo>>({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Error fetching stash:', error);
    return c.json<APIResponse<never>>(
      {
        success: false,
        error: 'Failed to fetch stash',
      },
      500
    );
  }
});
