// ============================================
// Shared Types
// ============================================

// Generic API response wrapper for consistent error handling
export type APIResponse<T> = { success: true; data: T } | { success: false; error: string };

// ============================================
// Stash Types
// ============================================

export type GeneratedPreviewKind = 'text-peek' | 'file-summary';

export interface TextPreviewOptions {
  mode: 'auto' | 'excerpt';
  lineLimit: 4 | 10 | 20 | 50;
  maxBytes: number;
  maxChars: number;
  maxPreviewRatio: number;
}

export type FileSummaryOptions = Record<string, never>;

export interface TextPreviewMetadata {
  offset: number;
  lineLimit: 4 | 10 | 20 | 50;
  linesIncluded: number;
  bytesRead: number;
  previewBytes: number;
  truncated: boolean;
}

export interface FileSummaryMetadata {
  reason: 'unsupported-type' | 'decode-failed' | 'preview-disabled' | 'preview-would-reveal-file';
}

export interface GeneratedPreviewPayload {
  version: 'stashu-generated-preview-v1';
  kind: GeneratedPreviewKind;
  fileName: string;
  fileType: string;
  fileSize: number;
  contentType: string;
  options: TextPreviewOptions | FileSummaryOptions;
  metadata: TextPreviewMetadata | FileSummaryMetadata;
  bytes: string;
}

export interface StashProof {
  version: 'stashu-preview-v1' | 'stashu-preview-v2';
  root: string;
  previewHash: string;
  contentMerkleRoot: string;
  contentLength: number;
  chunkSize: number;
  sealedBlobSha256?: string;
  previewInclusion?: PreviewInclusionProof;
}

export interface MerkleProofStep {
  side: 'left' | 'right';
  hash: string;
}

export interface PreviewInclusionProof {
  offset: number;
  length: number;
  leafHash: string;
  path: MerkleProofStep[];
}

export interface StashProofSecret {
  contentSalt: string;
}

export interface Stash {
  id: string;
  blobUrl: string;
  blobSha256?: string;
  secretKey: string;
  sellerPubkey: string;
  priceSats: number;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  blobFormat?: StashBlobFormat;
  previewUrl?: string;
  generatedPreview?: GeneratedPreviewPayload;
  previewProof?: StashProof;
  previewSecret?: StashProofSecret;
  // When true, priceSats is a minimum and the buyer picks the amount.
  payWhatYouWant?: boolean;
  createdAt: number;
}

// Public info shown to buyers (no sensitive data)
export interface StashPublicInfo {
  id: string;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  // The minimum when payWhatYouWant is true, otherwise the price.
  priceSats: number;
  payWhatYouWant: boolean;
  // False once the seller unpublishes it: no new payments, but buyers who
  // already paid can still re-download.
  published: boolean;
  blobFormat?: StashBlobFormat;
  sealedBlobUrl?: string;
  blobSha256?: string;
  previewUrl?: string;
  generatedPreview?: GeneratedPreviewPayload;
  previewProof?: StashProof;
  // How long (seconds) a buyer can re-download on their device after paying.
  // Always resolved server-side (legacy stashes fall back to the default).
  downloadWindowSeconds: number;
}

// ============================================
// Public manifest
// ============================================

export const STASH_MANIFEST_VERSION = 'stashu-manifest-v1' as const;

// Paths are relative to the API origin the manifest was fetched from and may
// contain {placeholder} template segments.
export interface ManifestEndpoint {
  method: 'GET' | 'POST';
  path: string;
}

export type StashManifestPreview =
  | { kind: 'generated'; generated: GeneratedPreviewPayload; proof: StashProof }
  | { kind: 'image'; imageUrl: string }
  | { kind: 'none' };

// Machine-readable public shape of a stash for external tools (CLI, SDK,
// embed cards). Public info only — never contains the decrypt key, proof
// secret (contentSalt), Cashu tokens, or the seller pubkey.
export interface StashManifest {
  version: typeof STASH_MANIFEST_VERSION;
  id: string;
  title: string;
  description?: string;
  file: {
    name: string;
    size: number;
  };
  // The minimum when payWhatYouWant is true: send amountSats to the invoice
  // and unlock endpoints to pay more.
  priceSats: number;
  payWhatYouWant: boolean;
  // False when the seller has stopped selling it: the payment endpoints refuse
  // new payments.
  published: boolean;
  payment: {
    methods: ['lightning', 'cashu'];
    endpoints: {
      invoice: ManifestEndpoint;
      status: ManifestEndpoint;
      unlock: ManifestEndpoint;
      claim: ManifestEndpoint;
    };
  };
  // Present only for sealed (stashu-selective-v1) packages
  blob?: {
    format: StashBlobFormat;
    url: string;
    sha256?: string;
  };
  preview: StashManifestPreview;
  // True for pre-sealed-package stashes
  legacy: boolean;
  downloadWindowSeconds: number;
}

// ============================================
// Re-download window
// ============================================

// Per-stash re-download grace period: how long after paying a buyer can
// re-download on the same device using their claim token. Seller picks one
// of these on /sell. Day-based only — no hour granularity, no "never".
export const DOWNLOAD_WINDOW_OPTIONS = [
  { value: 86_400, label: '1 day' },
  { value: 604_800, label: '7 days' },
  { value: 2_592_000, label: '30 days' },
] as const;

// Used when a seller doesn't choose, and for legacy stashes created before
// this feature (stored window is NULL).
export const DEFAULT_DOWNLOAD_WINDOW_SECONDS = 604_800; // 7 days

export const ALLOWED_DOWNLOAD_WINDOW_SECONDS: ReadonlySet<number> = new Set(
  DOWNLOAD_WINDOW_OPTIONS.map((option) => option.value)
);

// ============================================
// Payment Types
// ============================================

export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'mint_failed';

export interface Payment {
  id: string;
  stashId: string;
  status: PaymentStatus;
  tokenHash: string;
  sellerToken?: string;
  createdAt: number;
  paidAt?: number;
}

// ============================================
// API Request/Response Types
// ============================================

// POST /api/stash
export interface CreateStashRequest {
  blobUrl: string;
  blobSha256?: string;
  secretKey: string;
  sellerPubkey: string;
  priceSats: number;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  blobFormat?: StashBlobFormat;
  previewUrl?: string;
  generatedPreview?: GeneratedPreviewPayload;
  previewProof?: StashProof;
  previewSecret?: StashProofSecret;
  // One of DOWNLOAD_WINDOW_OPTIONS. Omitted falls back to the default server-side.
  downloadWindowSeconds?: number;
  // Makes priceSats a minimum; the buyer picks any amount at or above it.
  payWhatYouWant?: boolean;
}

export type StashBlobFormat = 'stashu-selective-v1';

export interface CreateStashResponse {
  id: string;
  shareUrl: string;
}

// PATCH /api/stash/:id — send only what changes. The file, its preview and
// its proofs are fixed at creation and can't be edited.
export interface UpdateStashRequest {
  title?: string;
  // An empty string removes the description.
  description?: string;
  priceSats?: number;
  payWhatYouWant?: boolean;
  published?: boolean;
}

export interface UpdateStashResponse {
  title: string;
  description?: string;
  priceSats: number;
  payWhatYouWant: boolean;
  published: boolean;
}

// DELETE /api/stash/:id — where the encrypted file lived, so the seller's
// browser can ask those Blossom servers to delete it. Only the seller's key
// can do that; the Stashu server can't.
export interface DeleteStashResponse {
  blobUrl: string;
  blobSha256?: string;
}

// POST /api/unlock/:id
export interface UnlockRequest {
  token: string;
  // Pay-what-you-want stashes only: what the buyer chose to pay. The token
  // must credit exactly this. Omitted means the minimum.
  amountSats?: number;
}

export interface UnlockResponse {
  secretKey: string;
  blobUrl: string;
  blobSha256?: string;
  fileName: string;
  claimToken?: string;
  claimExpiresAt?: number; // unix seconds — when the re-download window ends
  previewSecret?: StashProofSecret;
}

// GET /api/earnings (for seller dashboard)
export interface EarningsResponse {
  tokens: string[];
  totalSats: number;
}

export interface SellerStashStats {
  id: string;
  title: string;
  description?: string;
  priceSats: number;
  payWhatYouWant: boolean;
  published: boolean;
  unlockCount: number;
  totalEarned: number;
  createdAt: number;
  showInStorefront: boolean;
}

// GET /api/dashboard/:pubkey
export interface DashboardResponse {
  // Deleted stashes are left out.
  stashes: SellerStashStats[];
  earnings: EarningsResponse;
  // Everything ever earned, deleted stashes included.
  totalRevenueSats: number;
  storefrontEnabled: boolean;
}

// POST /api/withdraw/quote
// Note: pubkey comes from NIP-98 auth header, not the request body
export interface WithdrawQuoteRequest {
  invoice: string;
}

export interface WithdrawQuoteResponse {
  totalSats: number;
  feeSats: number;
  netSats: number;
  invoiceAmountSats: number;
}

// POST /api/withdraw/execute
// Note: pubkey comes from NIP-98 auth header, not the request body
export interface WithdrawRequest {
  invoice: string;
}

export interface WithdrawResponse {
  paid: boolean;
  feeSats: number;
  preimage: string;
}

// POST /api/pay/:id/invoice
export interface PayInvoiceRequest {
  // Pay-what-you-want stashes only: what the buyer chose to pay. Omitted
  // means the minimum.
  amountSats?: number;
}

export interface PayInvoiceResponse {
  invoice: string;
  quoteId: string;
  amountSats: number;
  expiresAt: number; // unix timestamp
}

// GET /api/pay/:id/status/:quoteId
export interface PayStatusResponse {
  paid: boolean;
  secretKey?: string;
  blobUrl?: string;
  blobSha256?: string;
  fileName?: string;
  claimToken?: string;
  claimExpiresAt?: number; // unix seconds — when the re-download window ends
  previewSecret?: StashProofSecret;
}

// POST /api/withdraw/resolve-address
export interface LnAddressResolveRequest {
  address: string;
  amountSats: number;
}

export interface LnAddressResolveResponse {
  invoice: string;
}

// GET/POST /api/settings
export interface SellerSettings {
  lnAddress: string;
  autoWithdrawThreshold: number; // in sats, 0 = disabled
  storefrontEnabled: boolean;
}

// GET /api/dashboard/:pubkey/settlements
export interface SettlementLogEntry {
  id: number;
  status: 'success' | 'failed' | 'skipped';
  amountSats: number | null;
  feeSats: number | null;
  netSats: number | null;
  lnAddress: string | null;
  error: string | null;
  createdAt: number;
}
