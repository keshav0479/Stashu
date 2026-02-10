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

  // Fetch LNURL-pay metadata from the well-known endpoint
  const metaUrl = `https://${domain}/.well-known/lnurlp/${user}`;
  const metaResponse = await fetch(metaUrl);

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
    throw new Error(
      `Amount ${amountSats} sats is outside the allowed range: ${minSats}–${maxSats} sats`
    );
  }

  // Request an invoice from the callback URL
  const separator = meta.callback.includes('?') ? '&' : '?';
  const invoiceUrl = `${meta.callback}${separator}amount=${amountMsats}`;
  const invoiceResponse = await fetch(invoiceUrl);

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
