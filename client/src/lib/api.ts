import type {
  APIResponse,
  CreateStashRequest,
  CreateStashResponse,
  StashPublicInfo,
  UnlockRequest,
  UnlockResponse,
  DashboardResponse,
  WithdrawQuoteRequest,
  WithdrawQuoteResponse,
  WithdrawRequest,
  WithdrawResponse,
} from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

/**
 * Create a new stash on the backend
 */
export async function createStash(request: CreateStashRequest): Promise<CreateStashResponse> {
  const response = await fetch(`${API_BASE}/stash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const result: APIResponse<CreateStashResponse> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Get public info about a stash
 */
export async function getStashInfo(id: string): Promise<StashPublicInfo> {
  const response = await fetch(`${API_BASE}/stash/${id}`);
  const result: APIResponse<StashPublicInfo> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Unlock a stash with a Cashu token
 */
export async function unlockStash(id: string, token: string): Promise<UnlockResponse> {
  const response = await fetch(`${API_BASE}/unlock/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token } as UnlockRequest),
  });

  const result: APIResponse<UnlockResponse> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

export async function getDashboard(pubkey: string): Promise<DashboardResponse> {
  const response = await fetch(`${API_BASE}/dashboard/${pubkey}`);
  const result: APIResponse<DashboardResponse> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Get a fee quote for Lightning withdrawal
 */
export async function getWithdrawQuote(
  pubkey: string,
  invoice: string
): Promise<WithdrawQuoteResponse> {
  const response = await fetch(`${API_BASE}/withdraw/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey, invoice } as WithdrawQuoteRequest),
  });

  const result: APIResponse<WithdrawQuoteResponse> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Execute a Lightning withdrawal
 */
export async function executeWithdraw(pubkey: string, invoice: string): Promise<WithdrawResponse> {
  const response = await fetch(`${API_BASE}/withdraw/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey, invoice } as WithdrawRequest),
  });

  const result: APIResponse<WithdrawResponse> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}
