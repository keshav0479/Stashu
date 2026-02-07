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
