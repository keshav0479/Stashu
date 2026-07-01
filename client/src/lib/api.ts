import type {
  APIResponse,
  CreateStashRequest,
  CreateStashResponse,
  StashPublicInfo,
  UnlockRequest,
  UnlockResponse,
  DashboardResponse,
  WithdrawQuoteResponse,
  WithdrawResponse,
  PayInvoiceResponse,
  PayStatusResponse,
  LnAddressResolveResponse,
  SellerSettings,
  SettlementLogEntry,
} from '../../../shared/types';
import { createAuthHeader } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const INVOICE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Create a new stash on the backend
 */
export async function createStash(request: CreateStashRequest): Promise<CreateStashResponse> {
  const url = `${API_BASE}/stash`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: createAuthHeader(url, 'POST'),
    },
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

/**
 * Re-fetch unlock data using a claim token (no re-payment needed)
 */
export async function claimStash(stashId: string, claimToken: string): Promise<UnlockResponse> {
  const response = await fetch(
    `${API_BASE}/unlock/${stashId}/claim?token=${encodeURIComponent(claimToken)}`
  );
  const result: APIResponse<UnlockResponse> = await response.json();
  if (!result.success) {
    const err = new Error(result.error) as Error & { status: number };
    err.status = response.status;
    throw err;
  }
  return result.data;
}

export async function getDashboard(pubkey: string): Promise<DashboardResponse> {
  const url = `${API_BASE}/dashboard/${pubkey}`;
  const response = await fetch(url, {
    headers: { Authorization: createAuthHeader(url, 'GET') },
  });
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
  _pubkey: string,
  invoice: string
): Promise<WithdrawQuoteResponse> {
  const url = `${API_BASE}/withdraw/quote`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: createAuthHeader(url, 'POST'),
    },
    body: JSON.stringify({ invoice }),
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
export async function executeWithdraw(
  _pubkey: string,
  invoice: string,
  lnAddress?: string
): Promise<WithdrawResponse> {
  const url = `${API_BASE}/withdraw/execute`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: createAuthHeader(url, 'POST'),
    },
    body: JSON.stringify({ invoice, lnAddress }),
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
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/pay/${stashId}/invoice`, {
      method: 'POST',
      signal: AbortSignal.timeout(INVOICE_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error('Invoice request timed out. Please try again shortly.');
    }
    throw error;
  }

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
  const url = `${API_BASE}/withdraw/resolve-address`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: createAuthHeader(url, 'POST'),
    },
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
  const url = `${API_BASE}/settings/${pubkey}`;
  const response = await fetch(url, {
    headers: { Authorization: createAuthHeader(url, 'GET') },
  });
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
  const url = `${API_BASE}/settings/${pubkey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: createAuthHeader(url, 'POST'),
    },
    body: JSON.stringify(settings),
  });
  const result: APIResponse<SellerSettings> = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

/**
 * Get settlement history for a seller
 */
/**
 * Toggle a stash's storefront visibility
 */
export async function toggleStashVisibility(
  stashId: string,
  showInStorefront: boolean
): Promise<{ showInStorefront: boolean }> {
  const url = `${API_BASE}/stash/${stashId}/visibility`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: createAuthHeader(url, 'POST'),
    },
    body: JSON.stringify({ showInStorefront }),
  });

  const result: APIResponse<{ showInStorefront: boolean }> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Get all stashes by a seller (public storefront, no auth)
 */
export async function getSellerStorefront(pubkey: string): Promise<StashPublicInfo[]> {
  const response = await fetch(`${API_BASE}/seller/${pubkey}`);
  const result: APIResponse<StashPublicInfo[]> = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

export async function getSettlements(pubkey: string): Promise<SettlementLogEntry[]> {
  const url = `${API_BASE}/dashboard/${pubkey}/settlements`;
  const response = await fetch(url, {
    headers: { Authorization: createAuthHeader(url, 'GET') },
  });
  const result: APIResponse<SettlementLogEntry[]> = await response.json();
  if (!result.success) throw new Error(result.error);
  return result.data;
}
