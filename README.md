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

# Configure environment (optional — defaults work for local dev)
cp server/.env.example server/.env
cp client/.env.example client/.env

npm run dev
```

- **Client:** http://localhost:5173
- **Server:** http://localhost:3000
  |

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

## Security

- **Client-side encryption** — Files encrypted with XChaCha20-Poly1305 before upload. Server never sees plaintext.
- **NIP-98 auth** — Seller endpoints (dashboard, earnings, settings, withdrawals) require a signed Nostr event proving pubkey ownership. Prevents unauthorized access and fund theft.
- **No accounts** — Identity is a local Nostr keypair stored in browser. Recoverable via nsec.
- **Idempotent payments** — Token hash deduplication prevents double-spending.

## Roadmap

### Phase 1: Project Setup

- [x] Monorepo structure (client, server, shared)
- [x] Vite + React + TypeScript frontend
- [x] TailwindCSS with custom design system
- [x] Hono backend with TypeScript
- [x] SQLite database setup (WAL mode)
- [x] Shared types package

### Phase 2: Seller Flow

- [x] Local Nostr keypair with nsec recovery
- [x] Drag-and-drop file upload
- [x] Client-side XChaCha20-Poly1305 encryption
- [x] Blossom upload with NIP-98 auth
- [x] Stash creation API
- [x] Shareable link generation

### Phase 3: Buyer Flow

- [x] Buyer preview page
- [x] Cashu token paste interface
- [x] Token verification and swap
- [x] Idempotent payment processing
- [x] Decryption key release
- [x] Client-side decryption and download

### Phase 4: Database

- [x] Stashes table schema
- [x] Payments table schema
- [x] Seller settings table
- [x] Settlement log table
- [x] Earnings API endpoint

### Phase 5: UX Improvements

- [x] Recovery token modal (prevent fund loss)
- [x] Seller dashboard with earnings display
- [x] Toast notifications
- [x] Dashboard link on homepage
- [x] Restore account page (`/restore`)
- [x] Hide nsec by default (reveal toggle)
- [x] Settings page (`/settings`)
- [ ] "How it Works" section on homepage

### Phase 6: Lightning Withdrawal (Seller)

- [x] One-click Lightning withdrawal
- [x] BOLT11 invoice input
- [x] Lightning address support (LUD-16)
- [x] Token aggregation server-side
- [x] Fee estimation display
- [x] Mark tokens as claimed
- [x] Settlement history modal

### Phase 7: Lightning Pay (Buyer)

- [x] Lightning invoice QR code on unlock page
- [x] Server-side mint quote creation
- [x] Auto-polling for payment confirmation
- [x] Server-side token minting after payment
- [x] Auto-download on payment
- [x] Cashu token paste as fallback option
- [x] Invoice expiry countdown + refresh
- [x] `lightning:` deep link for mobile wallets
- [x] Mint failure recovery

### Phase 8: Sovereignty Upgrades

- [x] Auto-settlement via Lightning address (configurable threshold in settings)
- [x] NIP-98 HTTP Auth on all seller endpoints
- [ ] Fee transparency (warn when fee > 10% of withdrawal)
- [ ] Encrypted token storage (encrypt seller_token at rest)
- [ ] Browser-local wallet (move tokens client-side, delete from server)

### Phase 9: Payment Flexibility

- [ ] Multiple Cashu mints
- [ ] WebLN integration
- [ ] Nostr Wallet Connect
- [ ] Split payments (revenue share)

### Phase 10: Production Hardening

- [x] Configurable environment variables (PORT, MINT_URL, DB_PATH, CORS, API URL, Blossom URL)
- [x] Production CORS configuration
- [ ] OG meta tags for link previews
- [ ] Custom 404 error page
- [ ] Dockerfile + Docker Compose
- [ ] HTTPS / reverse proxy guide

### Phase 11: Discoverability

- [ ] Nostr event publishing
- [ ] NSFW content flagging
- [ ] Agent API

## License

MIT
