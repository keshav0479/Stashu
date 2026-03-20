<div align="center">
  <img src="client/src/assets/logo.png" alt="Stashu Logo" width="120">
  <h1>Stashu</h1>
  <p>
    <strong>The Blind Vending Machine for the Sovereign Web</strong>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Storage-Blossom-purple" alt="Blossom">
    <img src="https://img.shields.io/badge/Payment-Cashu_%2B_Lightning-orange" alt="Cashu + Lightning">
    <img src="https://img.shields.io/badge/Encryption-XChaCha20--Poly1305-blue" alt="XChaCha20-Poly1305">
    <img src="https://img.shields.io/badge/Auth-NIP--98-blueviolet" alt="NIP-98">
    <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  </p>
</div>

---

## What is Stashu?

Stashu is a trust-minimized protocol for selling digital files for Bitcoin. No accounts, no KYC, no intermediaries.

**How it works:**

1. Seller uploads file → encrypted client-side with XChaCha20-Poly1305 → stored on Blossom
2. Seller sets price in sats → gets shareable link
3. Buyer scans Lightning QR or pastes Cashu token → pays → receives decryption key
4. Buyer downloads and decrypts locally → done

**Privacy-first:** All encryption happens client-side. The server never sees your files. Sellers are identified by a local Nostr keypair — no emails, no passwords.

## Quick Start

```bash
git clone https://github.com/keshav0479/Stashu.git
cd Stashu
npm install

# Configure environment
cp server/.env.example server/.env
# ⚠️ server/.env requires TOKEN_ENCRYPTION_KEY — generate one:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

cp client/.env.example client/.env  # Optional — defaults work for local dev

npm run dev
```

- **Client:** http://localhost:5173
- **Server:** http://localhost:3000

## Tech Stack

| Layer      | Technology                                |
| ---------- | ----------------------------------------- |
| Frontend   | React, Vite, TypeScript, TailwindCSS      |
| Backend    | Hono, TypeScript                          |
| Database   | SQLite (better-sqlite3, WAL mode)         |
| Storage    | Blossom (BUD-02)                          |
| Encryption | XChaCha20-Poly1305 via `@noble/ciphers`   |
| Payment    | Cashu + Lightning (LUD-16)                |
| Identity   | Local Nostr keypair with nsec recovery    |
| Auth       | NIP-98 HTTP Auth (Nostr event signatures) |

## Security Model

> **Stashu V1 is a trusted escrow.** Here's what's protected today, what isn't, and what we plan to remove in V2.

### What IS encrypted/protected

- **Files in transit and at rest** — XChaCha20-Poly1305 encryption happens entirely in the browser before upload. Blossom servers and anyone intercepting traffic see only ciphertext.
- **Sensitive DB columns** — `secret_key`, `title`, `description`, `file_name`, `seller_token`, `ln_address`, and change proof tokens are all encrypted at rest with XChaCha20-Poly1305 (`TOKEN_ENCRYPTION_KEY`). A raw DB dump reveals no plaintext file keys, metadata, or Lightning addresses.
- **Seller identity** — NIP-98 Schnorr signatures on all seller endpoints. No passwords, no sessions — cryptographic auth only.
- **Payment integrity** — Quote-to-stash binding prevents cross-stash replay. Atomic processing lock prevents concurrent mint races. Idempotent unlock prevents double-spending.
- **Rate limiting** — Public endpoints rate-limited (~10–60 req/min). With `TRUSTED_PROXY=1`, limits apply per client IP.

### What is NOT protected (known limitations)

| Data                     | Where                | Risk                                                                                                    |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------- |
| Nostr private key        | Browser localStorage | XSS could steal nsec — same trade-off as every Nostr web client                                         |
| All encrypted DB columns | Server env           | `TOKEN_ENCRYPTION_KEY` lives on the same server as the DB. A full server compromise exposes everything. |
| Seller tokens            | Server DB            | Server custodies Cashu tokens between payment and withdrawal. Operator could theoretically drain funds. |

### V2 Roadmap (removing the need to trust the server)

1. **Nostr DM key exchange** — Deliver decryption keys to buyers via NIP-44 encrypted DMs. Server never sees `secret_key`.
2. **P2PK token swaps** — NUT-11 Pay-to-Public-Key Cashu tokens lock funds to the seller's pubkey. Server facilitates but can't spend.
3. **Multi-mint support** — Remove single `MINT_URL` dependency.

## Roadmap

### Complete

- **Project Setup** — Monorepo, Vite + React + TypeScript, Hono backend, SQLite (WAL), shared types
- **Seller Flow** — Local Nostr keypair, drag-and-drop upload, client-side encryption, Blossom upload, stash creation with NIP-98 auth
- **Buyer Flow** — Preview page, Cashu token paste, Lightning QR payment, token verification/swap, decryption key release, client-side decrypt + download
- **Database** — Stashes, payments, seller settings, settlement log tables with proper indexes
- **UX** — Recovery token modal, seller dashboard, toast notifications, mobile-responsive, settings page, restore account, Lucide icons
- **Lightning Withdrawal** — One-click withdrawal, BOLT11 + LN address (LUD-16), token aggregation, fee estimation, settlement history
- **Lightning Pay** — Invoice QR, mint quote polling, server-side minting, auto-download, expiry countdown, invoice persistence
- **Auto-Settlement** — Configurable threshold, automatic LN address payout, settlement logging
- **Security Hardening** — NIP-98 auth on all seller endpoints, rate limiting, anti-replay binding, atomic processing lock, stale quote cleanup, stuck-processing recovery
- **Encryption at Rest** — All sensitive DB columns encrypted with XChaCha20-Poly1305: file keys, stash metadata, LN addresses, Cashu tokens. Versioned migration system via `schema_version` table.
- **Payment Recovery** — Change proof persistence + reuse in withdrawals, pending melt tracking, mint failure auto-retry on startup
- **Infrastructure** — Cashu-ts v3.5.0, Docker + Docker Compose, GitHub Actions CI (build + lint + format), OG meta tags, custom 404 page
- **Environment Config** — PORT, MINT_URL, DB_PATH, CORS_ORIGINS, VITE_API_URL, VITE_BLOSSOM_URL

### Next Up

- [ ] Fee transparency (warn when fee > 10% of withdrawal)
- [ ] Stash lifecycle (edit price/description, unpublish/delete)
- [ ] NIP-99 marketplace event publishing
- [ ] HTTPS / reverse proxy guide (Caddy)

### Future

- [ ] Client-to-buyer key exchange (zero-knowledge file access)
- [ ] Non-custodial token swaps (remove server custody)
- [ ] Multiple Cashu mints
- [ ] WebLN integration
- [ ] Nostr Wallet Connect
- [ ] Split payments (revenue share)
- [ ] Browser-local wallet (move tokens client-side)
- [ ] NIP-98 payload hash binding

## Development & Testing

Stashu uses Cashu ecash mints for payments. For local development, you'll need access to a mint with real (small amounts of) sats:

| Mint                 | URL                                      | Notes                         |
| -------------------- | ---------------------------------------- | ----------------------------- |
| Minibits             | `https://mint.minibits.cash/Bitcoin`     | Default. Reliable, small fees |
| LNbits (self-hosted) | `http://localhost:5000/cashu/api/v1/...` | Run your own — full control   |

**Getting test sats:**

1. Install [Minibits](https://www.minibits.cash) (mobile) or use [Nutstash](https://nutstash.app) (web)
2. Receive a small Lightning payment (10-100 sats) from a faucet or friend
3. Mint Cashu tokens from the Lightning payment
4. Use those tokens to test the buy flow, or paste invoices for the sell flow

> **Tip:** Since Cashu operates on mainnet Lightning, there's no "testnet" mode. Keep test amounts small (10-100 sats). If you want a fully isolated setup, self-host an [LNbits](https://github.com/lnbits/lnbits) instance with the Cashu extension.

## License

MIT
