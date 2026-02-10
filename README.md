<div align="center">
  <img src="client/src/assets/logo.png" alt="Stashu Logo" width="120">
  <h1>Stashu</h1>
  <p>
    <strong>The Blind Vending Machine for the Sovereign Web</strong>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Storage-Blossom-purple" alt="Blossom">
    <img src="https://img.shields.io/badge/Payment-Cashu_%2B_Lightning-orange" alt="Cashu + Lightning">
    <img src="https://img.shields.io/badge/Encryption-NIP--44-blue" alt="NIP-44">
    <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  </p>
</div>

---

## What is Stashu?

Stashu is a trust-minimized protocol for selling digital files for Bitcoin. No accounts, no KYC, no intermediaries.

**How it works:**

1. Seller uploads file → encrypted client-side → stored on Blossom
2. Seller sets price in sats → gets shareable link
3. Buyer scans Lightning QR → pays with any wallet → receives decryption key
4. Buyer downloads and decrypts → done

## Quick Start

```bash
git clone https://github.com/keshav0479/Stashu.git
cd Stashu
npm install
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3000

## Tech Stack

| Layer      | Technology                           |
| ---------- | ------------------------------------ |
| Frontend   | React, Vite, TypeScript, TailwindCSS |
| Backend    | Hono, TypeScript                     |
| Database   | SQLite (better-sqlite3)              |
| Storage    | Blossom (BUD-02)                     |
| Encryption | XChaCha20-Poly1305 (NIP-44)          |
| Payment    | Cashu + Lightning (LUD-16)           |
| Identity   | Local keypair with recovery token    |

## Roadmap

### Phase 1: Project Setup

- [x] Monorepo structure (client, server, shared)
- [x] Vite + React + TypeScript frontend
- [x] TailwindCSS with custom design system
- [x] Hono backend with TypeScript
- [x] SQLite database setup
- [x] Shared types package

### Phase 2: Seller Flow

- [x] Local keypair with recovery token
- [x] Drag-and-drop file upload
- [x] Client-side XChaCha20-Poly1305 encryption
- [x] Key backup to seller pubkey
- [x] Blossom upload with auth
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
- [x] Earnings API endpoint
- [x] Database indexes

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
- [x] Lightning address support (user@domain.com)
- [x] Token aggregation server-side
- [x] Fee estimation display
- [x] Mark tokens as claimed

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

- [ ] Auto-settlement via Lightning address (save in settings, auto-withdraw on threshold)
- [ ] Fee transparency (warn when fee > 10% of withdrawal)
- [ ] Encrypted token storage (NIP-44 encrypt seller_token with seller's pubkey)
- [ ] Browser-local wallet (move tokens client-side, delete from server)

### Phase 9: Payment Flexibility

- [ ] Multiple Cashu mints
- [ ] WebLN integration
- [ ] Nostr Wallet Connect
- [ ] Split payments (revenue share)

### Phase 10: Polish

- [ ] Smart file previews
- [x] Environment variables (API, CORS, Blossom)
- [x] Production CORS configuration
- [ ] OG meta tags for link previews
- [ ] Rate limiting
- [ ] 404 error page

### Phase 11: Discoverability

- [ ] Nostr event publishing
- [ ] NSFW content flagging
- [ ] Agent API

## License

MIT
