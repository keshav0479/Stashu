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
  PayInvoiceResponse,
  PayStatusResponse,
  LnAddressResolveResponse,
  SellerSettings,
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

/**
 * Create a Lightning invoice for paying for a stash
 */
export async function createPayInvoice(stashId: string): Promise<PayInvoiceResponse> {
  const response = await fetch(`${API_BASE}/pay/${stashId}/invoice`, {
    method: 'POST',
  });

  const result: APIResponse<PayInvoiceResponse> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Check payment status for a Lightning invoice
 */
export async function checkPayStatus(stashId: string, quoteId: string): Promise<PayStatusResponse> {
  const response = await fetch(`${API_BASE}/pay/${stashId}/status/${quoteId}`);

  const result: APIResponse<PayStatusResponse> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Resolve a Lightning address (user@domain) to a BOLT11 invoice
 */
export async function resolveLnAddress(
  address: string,
  amountSats: number
): Promise<LnAddressResolveResponse> {
  const response = await fetch(`${API_BASE}/withdraw/resolve-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, amountSats }),
  });

  const result: APIResponse<LnAddressResolveResponse> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Get seller's auto-settlement settings
 */
export async function getSettings(pubkey: string): Promise<SellerSettings> {
  const response = await fetch(`${API_BASE}/settings/${pubkey}`);
  const result: APIResponse<SellerSettings> = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

/**
 * Save seller's auto-settlement settings
 */
export async function saveSettings(
  pubkey: string,
  settings: SellerSettings
): Promise<SellerSettings> {
  const response = await fetch(`${API_BASE}/settings/${pubkey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  const result: APIResponse<SellerSettings> = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}
