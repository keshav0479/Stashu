// ============================================
// Shared Types
// ============================================

// Generic API response wrapper for consistent error handling
export type APIResponse<T> = { success: true; data: T } | { success: false; error: string };

// ============================================
// Stash Types
// ============================================

export interface Stash {
  id: string;
  blobUrl: string;
  secretKey: string;
  keyBackup?: string;
  sellerPubkey: string;
  priceSats: number;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  previewUrl?: string;
  createdAt: number;
}

// Public info shown to buyers (no sensitive data)
export interface StashPublicInfo {
  id: string;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  priceSats: number;
  previewUrl?: string;
}

// ============================================
// Payment Types
// ============================================

export type PaymentStatus = 'pending' | 'paid' | 'failed';

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
  secretKey: string;
  keyBackup?: string;
  sellerPubkey: string;
  priceSats: number;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  previewUrl?: string;
}

export interface CreateStashResponse {
  id: string;
  shareUrl: string;
}

// POST /api/unlock/:id
export interface UnlockRequest {
  token: string;
}

export interface UnlockResponse {
  secretKey: string;
  blobUrl: string;
  fileName: string;
}

// GET /api/earnings (for seller dashboard)
export interface EarningsResponse {
  tokens: string[];
  totalSats: number;
}

export interface SellerStashStats {
  id: string;
  title: string;
  priceSats: number;
  unlockCount: number;
  totalEarned: number;
  createdAt: number;
}

// GET /api/dashboard/:pubkey
export interface DashboardResponse {
  stashes: SellerStashStats[];
  earnings: EarningsResponse;
}

// POST /api/withdraw/quote
export interface WithdrawQuoteRequest {
  pubkey: string;
  invoice: string;
}

export interface WithdrawQuoteResponse {
  totalSats: number;
  feeSats: number;
  netSats: number;
  invoiceAmountSats: number;
}

// POST /api/withdraw/execute
export interface WithdrawRequest {
  pubkey: string;
  invoice: string;
}

export interface WithdrawResponse {
  paid: boolean;
  feeSats: number;
  preimage: string;
}

// POST /api/pay/:id/invoice
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
  fileName?: string;
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
}
