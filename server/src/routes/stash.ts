import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/index.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import type { AuthVariables } from '../middleware/auth.js';
import type {
  CreateStashRequest,
  CreateStashResponse,
  GeneratedPreviewPayload,
  StashProof,
  StashProofSecret,
  StashPublicInfo,
  APIResponse,
} from '../../../shared/types.js';
import type { StashRow } from '../db/types.js';

export const stashRoutes = new Hono<{ Variables: AuthVariables }>();

const HASH_RE = /^[0-9a-f]{64}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;
const MAX_PREVIEW_PAYLOAD_JSON_LENGTH = 64 * 1024;
const MAX_PREVIEW_BASE64URL_LENGTH = 64 * 1024;
const MAX_PREVIEW_CONTENT_BYTES = 16 * 1024;
const MAX_PREVIEW_CHARS = 4_000;
const MAX_MERKLE_PROOF_STEPS = 64;
const MAX_TEXT_PREVIEW_RATIO = 0.5;
const TEXT_LINE_LIMITS = new Set([4, 10, 20, 50]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isPositiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_RE.test(value);
}

function base64UrlDecodedLength(value: string): number | null {
  if (value.length % 4 === 1) return null;
  if (value.length === 0) return 0;

  const padding = value.length % 4 === 0 ? 0 : 4 - (value.length % 4);
  return ((value.length + padding) / 4) * 3 - padding;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (value.length % 4 === 1) return null;

  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
}

function decodePreviewText(value: string): string | null {
  const bytes = decodeBase64Url(value);
  if (!bytes) return null;

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isMerkleProofStep(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['side', 'hash']) &&
    (value.side === 'left' || value.side === 'right') &&
    isHash(value.hash)
  );
}

function isPreviewInclusionProof(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['offset', 'length', 'leafHash', 'path']) &&
    isPositiveInteger(value.offset, 100 * 1024 * 1024) &&
    isPositiveInteger(value.length, MAX_PREVIEW_CONTENT_BYTES) &&
    (value.length as number) > 0 &&
    isHash(value.leafHash) &&
    Array.isArray(value.path) &&
    value.path.length <= MAX_MERKLE_PROOF_STEPS &&
    value.path.every(isMerkleProofStep)
  );
}

function isStashProof(value: unknown): value is StashProof {
  if (!isRecord(value)) return false;

  const keys = [
    'version',
    'root',
    'previewHash',
    'contentMerkleRoot',
    'contentLength',
    'chunkSize',
    'previewInclusion',
  ];

  return (
    hasOnlyKeys(value, keys) &&
    value.version === 'stashu-preview-v1' &&
    isHash(value.root) &&
    isHash(value.previewHash) &&
    isHash(value.contentMerkleRoot) &&
    isPositiveInteger(value.contentLength, 100 * 1024 * 1024) &&
    isPositiveInteger(value.chunkSize, 1024 * 1024) &&
    (value.chunkSize as number) >= 1024 &&
    (value.previewInclusion === undefined || isPreviewInclusionProof(value.previewInclusion))
  );
}

function isPreviewSecret(value: unknown): value is StashProofSecret {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['contentSalt']) &&
    typeof value.contentSalt === 'string' &&
    HASH_RE.test(value.contentSalt)
  );
}

function isTextPreviewPayload(
  value: Record<string, unknown>,
  options: Record<string, unknown>,
  metadata: Record<string, unknown>
): boolean {
  const decodedPreviewLength =
    typeof value.bytes === 'string' ? base64UrlDecodedLength(value.bytes) : null;
  const decodedPreviewText =
    typeof value.bytes === 'string' ? decodePreviewText(value.bytes) : null;
  const decodedPreviewChars =
    decodedPreviewText === null ? null : Array.from(decodedPreviewText).length;
  const decodedPreviewLines = decodedPreviewText === null ? null : countLines(decodedPreviewText);

  return (
    value.kind === 'text-peek' &&
    decodedPreviewLength !== null &&
    decodedPreviewLength > 0 &&
    decodedPreviewText !== null &&
    decodedPreviewChars !== null &&
    decodedPreviewLines !== null &&
    hasOnlyKeys(options, ['mode', 'lineLimit', 'maxBytes', 'maxChars', 'maxPreviewRatio']) &&
    (options.mode === 'auto' || options.mode === 'excerpt') &&
    TEXT_LINE_LIMITS.has(options.lineLimit as number) &&
    isPositiveInteger(options.maxBytes, MAX_PREVIEW_CONTENT_BYTES) &&
    (options.maxBytes as number) > 0 &&
    isPositiveInteger(options.maxChars, MAX_PREVIEW_CHARS) &&
    (options.maxChars as number) > 0 &&
    typeof options.maxPreviewRatio === 'number' &&
    Number.isFinite(options.maxPreviewRatio) &&
    options.maxPreviewRatio >= 0 &&
    options.maxPreviewRatio <= MAX_TEXT_PREVIEW_RATIO &&
    hasOnlyKeys(metadata, [
      'offset',
      'lineLimit',
      'linesIncluded',
      'bytesRead',
      'previewBytes',
      'truncated',
    ]) &&
    isPositiveInteger(metadata.offset, value.fileSize as number) &&
    metadata.lineLimit === options.lineLimit &&
    isPositiveInteger(metadata.linesIncluded, options.lineLimit as number) &&
    isPositiveInteger(metadata.bytesRead, options.maxBytes as number) &&
    isPositiveInteger(metadata.previewBytes, metadata.bytesRead as number) &&
    (metadata.offset as number) + (metadata.previewBytes as number) <= (value.fileSize as number) &&
    metadata.previewBytes <= Math.floor((value.fileSize as number) * options.maxPreviewRatio) &&
    metadata.previewBytes === decodedPreviewLength &&
    decodedPreviewChars <= (options.maxChars as number) &&
    decodedPreviewLines <= (options.lineLimit as number) &&
    metadata.linesIncluded === decodedPreviewLines &&
    typeof metadata.truncated === 'boolean'
  );
}

function isFileSummaryPayload(
  value: Record<string, unknown>,
  options: Record<string, unknown>,
  metadata: Record<string, unknown>
): boolean {
  return (
    value.kind === 'file-summary' &&
    hasOnlyKeys(options, []) &&
    hasOnlyKeys(metadata, ['reason']) &&
    (metadata.reason === 'unsupported-type' ||
      metadata.reason === 'decode-failed' ||
      metadata.reason === 'preview-disabled' ||
      metadata.reason === 'preview-would-reveal-file') &&
    value.bytes === ''
  );
}

function isGeneratedPreviewPayload(
  value: unknown,
  fileName: string,
  fileSize: number
): value is GeneratedPreviewPayload {
  if (!isRecord(value) || !isRecord(value.options) || !isRecord(value.metadata)) return false;
  if (
    !hasOnlyKeys(value, [
      'version',
      'kind',
      'fileName',
      'fileType',
      'fileSize',
      'contentType',
      'options',
      'metadata',
      'bytes',
    ])
  ) {
    return false;
  }

  if (
    value.version !== 'stashu-generated-preview-v1' ||
    value.fileName !== fileName ||
    value.fileSize !== fileSize ||
    !isString(value.fileType, 200) ||
    !isString(value.contentType, 100) ||
    !isString(value.bytes, MAX_PREVIEW_BASE64URL_LENGTH) ||
    !BASE64URL_RE.test(value.bytes)
  ) {
    return false;
  }

  if (value.kind === 'text-peek') {
    return isTextPreviewPayload(value, value.options, value.metadata);
  }

  return isFileSummaryPayload(value, value.options, value.metadata);
}

function validatePreviewBundle(body: CreateStashRequest): string | null {
  const fields = [body.generatedPreview, body.previewProof, body.previewSecret];
  const provided = fields.filter((field) => field !== undefined && field !== null).length;

  if (provided === 0) return null;
  if (provided !== fields.length) {
    return 'generatedPreview, previewProof, and previewSecret must be provided together';
  }

  if (!isGeneratedPreviewPayload(body.generatedPreview, body.fileName, body.fileSize)) {
    return 'generatedPreview is invalid';
  }

  if (JSON.stringify(body.generatedPreview).length > MAX_PREVIEW_PAYLOAD_JSON_LENGTH) {
    return 'generatedPreview is too large';
  }

  if (!isStashProof(body.previewProof)) {
    return 'previewProof is invalid';
  }

  if (body.previewProof.contentLength !== body.fileSize) {
    return 'previewProof content length must match fileSize';
  }

  if (body.generatedPreview.kind === 'text-peek') {
    const { offset, previewBytes } = body.generatedPreview.metadata as {
      offset: number;
      previewBytes: number;
    };
    if (previewBytes > 0) {
      if (!body.previewProof.previewInclusion) {
        return 'previewProof must include text preview inclusion proof';
      }
      if (body.previewProof.previewInclusion.offset !== offset) {
        return 'previewProof preview offset must match generatedPreview metadata';
      }
      if (body.previewProof.previewInclusion.length !== previewBytes) {
        return 'previewProof preview length must match generatedPreview metadata';
      }
      if (offset + previewBytes > body.fileSize) {
        return 'previewProof preview range must fit inside the file';
      }
    }
  } else if (body.previewProof.previewInclusion) {
    return 'file-summary previews must not include preview inclusion proof';
  }

  if (!isPreviewSecret(body.previewSecret)) {
    return 'previewSecret is invalid';
  }

  return null;
}

function parseStoredJson<T>(value: string | null): T | undefined {
  return value ? (JSON.parse(decrypt(value)) as T) : undefined;
}

function stringifyEncryptedJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

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

    if (body.blobSha256 && !HASH_RE.test(body.blobSha256)) {
      return c.json<APIResponse<never>>(
        { success: false, error: 'blobSha256 must be 64 lowercase hex characters' },
        400
      );
    }

    const previewError = validatePreviewBundle(body);
    if (previewError) {
      return c.json<APIResponse<never>>({ success: false, error: previewError }, 400);
    }

    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO stashes (
        id, blob_url, blob_sha256, secret_key, seller_pubkey, price_sats,
        title, description, file_name, file_size, preview_url,
        generated_preview_payload, preview_proof, preview_secret
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      encrypt(body.blobUrl),
      body.blobSha256 || null,
      encrypt(body.secretKey),
      pubkey, // Use authed pubkey, not body.sellerPubkey (prevents spoofing)
      body.priceSats,
      encrypt(body.title),
      body.description ? encrypt(body.description) : null,
      encrypt(body.fileName),
      body.fileSize,
      body.previewUrl || null,
      body.generatedPreview ? stringifyEncryptedJson(body.generatedPreview) : null,
      body.previewProof ? stringifyEncryptedJson(body.previewProof) : null,
      body.previewSecret ? stringifyEncryptedJson(body.previewSecret) : null
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

// POST /api/stash/:id/visibility - Toggle storefront visibility (requires NIP-98 auth)
stashRoutes.post('/:id/visibility', async (c) => {
  try {
    const pubkey = c.get('authedPubkey');
    const id = c.req.param('id');

    let body: { showInStorefront: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json<APIResponse<never>>({ success: false, error: 'Invalid JSON body' }, 400);
    }

    if (typeof body.showInStorefront !== 'boolean') {
      return c.json<APIResponse<never>>(
        { success: false, error: 'showInStorefront must be a boolean' },
        400
      );
    }

    // Verify the stash belongs to this seller
    const stash = db
      .prepare('SELECT seller_pubkey, show_in_storefront FROM stashes WHERE id = ?')
      .get(id) as { seller_pubkey: string; show_in_storefront: number } | null;

    if (!stash) {
      return c.json<APIResponse<never>>({ success: false, error: 'Stash not found' }, 404);
    }

    if (stash.seller_pubkey !== pubkey) {
      return c.json<APIResponse<never>>({ success: false, error: 'Not your stash' }, 403);
    }

    const newValue = body.showInStorefront ? 1 : 0;
    db.prepare('UPDATE stashes SET show_in_storefront = ? WHERE id = ?').run(newValue, id);

    return c.json<APIResponse<{ showInStorefront: boolean }>>({
      success: true,
      data: { showInStorefront: body.showInStorefront },
    });
  } catch (error) {
    console.error('Error toggling visibility:', error);
    return c.json<APIResponse<never>>(
      { success: false, error: 'Failed to update visibility' },
      500
    );
  }
});

// GET /api/stash/:id - Get public stash info
stashRoutes.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const stmt = db.prepare(`
      SELECT id, title, description, file_name, file_size, price_sats, preview_url,
             generated_preview_payload, preview_proof
      FROM stashes WHERE id = ?
    `);

    const stash = stmt.get(id) as Pick<
      StashRow,
      | 'id'
      | 'title'
      | 'description'
      | 'file_name'
      | 'file_size'
      | 'price_sats'
      | 'preview_url'
      | 'generated_preview_payload'
      | 'preview_proof'
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
      generatedPreview: parseStoredJson<GeneratedPreviewPayload>(stash.generated_preview_payload),
      previewProof: parseStoredJson<StashProof>(stash.preview_proof),
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
