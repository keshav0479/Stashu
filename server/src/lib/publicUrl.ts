const RESERVED_TLDS = ['localhost', 'local', 'internal', 'intranet', 'corp', 'home', 'lan'];

/**
 * True when a hostname points at localhost, a reserved TLD, an IPv6 literal,
 * or a private/reserved IPv4 range. Shared SSRF guard for outbound requests.
 */
export function isPrivateOrReservedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower.startsWith('[') || lower.includes(':')) return true;
  if (RESERVED_TLDS.some((tld) => lower === tld || lower.endsWith(`.${tld}`))) return true;

  const octets = lower.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }

  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}
