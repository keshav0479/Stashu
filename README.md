<div align="center">
  <img src="client/src/assets/logo.png" alt="Stashu Logo" width="120">
  <h1>Stashu</h1>
  <p>
    <strong>The Blind Vending Machine for the Sovereign Web</strong>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Storage-Blossom-purple" alt="Blossom">
    <img src="https://img.shields.io/badge/Payment-Cashu-orange" alt="Cashu">
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
3. Buyer pays with Cashu token → receives decryption key
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
| Payment    | Cashu                                |
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
- [ ] Dashboard link on homepage
- [ ] Restore account page (`/restore`)
- [ ] Hide nsec by default (reveal toggle)
- [ ] Settings page (`/settings`)
- [ ] "How it Works" section on homepage

### Phase 6: Lightning Withdrawal

- [ ] One-click Lightning withdrawal
- [ ] Lightning address input
- [ ] Token aggregation server-side
- [ ] Fee estimation display
- [ ] Mark tokens as claimed

### Phase 7: Payment Flexibility

- [ ] Multiple Cashu mints
- [ ] WebLN integration
- [ ] Nostr Wallet Connect
- [ ] Split payments (revenue share)

### Phase 8: Polish

- [ ] Smart file previews
- [x] Environment variables (API, CORS, Blossom)
- [x] Production CORS configuration
- [ ] OG meta tags for link previews
- [ ] Rate limiting
- [ ] 404 error page

### Phase 9: Discoverability

- [ ] Nostr event publishing
- [ ] NSFW content flagging
- [ ] Agent API

## License

MIT
