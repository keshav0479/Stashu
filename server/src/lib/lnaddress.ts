/**
 * Validate that a domain is a public FQDN — not an IP, localhost, or reserved range.
 * Prevents SSRF via attacker-controlled Lightning addresses.
 */
function isPublicDomain(domain: string): boolean {
  // Block IP addresses (v4 and v6)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return false;
  if (domain.startsWith('[') || domain.includes(':')) return false;

  // Block localhost and reserved TLDs
  const blocked = ['localhost', 'local', 'internal', 'intranet', 'corp', 'home', 'lan'];
  const lower = domain.toLowerCase();
  if (blocked.some((b) => lower === b || lower.endsWith(`.${b}`))) return false;

  // Must have at least one dot (real domain)
  if (!domain.includes('.')) return false;

  return true;
}

/**
 * Validate that a URL is HTTPS and points to a public domain.
 */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return isPublicDomain(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Resolve a Lightning address (user@domain.com) to a BOLT11 invoice
 * Lightning addresses are LNURL-pay endpoints per LUD-16
 * https://github.com/lnurl/luds/blob/luds/16.md
 */
export async function resolveAddress(address: string, amountSats: number): Promise<string> {
  // Parse user@domain format
  const parts = address.split('@');
  if (parts.length !== 2) {
    throw new Error('Invalid Lightning address format. Expected user@domain.com');
  }

  const [user, domain] = parts;

  if (!isPublicDomain(domain)) {
    throw new Error('Invalid Lightning address: domain must be a public FQDN');
  }

  // Fetch LNURL-pay metadata from the well-known endpoint
  const metaUrl = `https://${domain}/.well-known/lnurlp/${user}`;
  const metaResponse = await fetch(metaUrl, { signal: AbortSignal.timeout(10_000) });

  if (!metaResponse.ok) {
    throw new Error(`Could not resolve Lightning address: ${metaResponse.statusText}`);
  }

  const meta = (await metaResponse.json()) as {
    callback: string;
    minSendable: number;
    maxSendable: number;
    tag: string;
    status?: string;
    reason?: string;
  };

  if (meta.status === 'ERROR') {
    throw new Error(meta.reason || 'Lightning address endpoint returned an error');
  }

  if (meta.tag !== 'payRequest') {
    throw new Error('Invalid Lightning address: not a pay request endpoint');
  }

  // LNURL amounts are in millisats
  const amountMsats = amountSats * 1000;

  if (amountMsats < meta.minSendable || amountMsats > meta.maxSendable) {
    const minSats = Math.ceil(meta.minSendable / 1000);
    const maxSats = Math.floor(meta.maxSendable / 1000);
    console.error(
      `LN address amount out of range: ${amountSats} sats (allowed: ${minSats}–${maxSats})`
    );
    throw new Error('Amount is outside the allowed range for this Lightning address');
  }

  // Validate callback URL — must be HTTPS and public domain (prevents SSRF)
  const separator = meta.callback.includes('?') ? '&' : '?';
  const invoiceUrl = `${meta.callback}${separator}amount=${amountMsats}`;

  if (!isSafeUrl(invoiceUrl)) {
    throw new Error('Invalid Lightning address: callback URL must be HTTPS on a public domain');
  }

  const invoiceResponse = await fetch(invoiceUrl, { signal: AbortSignal.timeout(10_000) });

  if (!invoiceResponse.ok) {
    throw new Error(`Failed to get invoice from Lightning address: ${invoiceResponse.statusText}`);
  }

  const invoiceData = (await invoiceResponse.json()) as {
    pr: string;
    status?: string;
    reason?: string;
  };

  if (invoiceData.status === 'ERROR') {
    throw new Error(invoiceData.reason || 'Failed to generate invoice');
  }

  if (!invoiceData.pr) {
    throw new Error('Lightning address did not return an invoice');
  }

  return invoiceData.pr;
}
