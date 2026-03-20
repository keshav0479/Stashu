# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Stashu?

Stashu is a pay-to-unlock file sharing platform built on Bitcoin ecash (Cashu protocol). Sellers upload encrypted files, buyers pay with Lightning or Cashu tokens to unlock them. No accounts or passwords — identity is a local Nostr keypair.

## Monorepo Structure

Three npm workspaces: `client/`, `server/`, `shared/`.

- **client** — React 19 + Vite + TailwindCSS 4 frontend
- **server** — Hono + better-sqlite3 + @cashu/cashu-ts backend
- **shared** — TypeScript types shared between client and server (`shared/types.ts`)

## Commands

```bash
# Development (runs client on :5173 and server on :3000 concurrently)
npm run dev

# Run only client or server
npm run dev:client
npm run dev:server

# Build everything
npm run build

# Run server tests (Node test runner with tsx)
npm run test --workspace=server
# or: cd server && npx tsx --test src/**/*.test.ts

# Lint (client only)
npm run lint --workspace=client

# Format check
npx prettier --check .

# Docker
docker compose up --build
```

## Environment Setup

Copy `.env.example` files in both `client/` and `server/`. The server requires a `TOKEN_ENCRYPTION_KEY` (64 hex chars) — it refuses to start without one.

Key server env vars: `MINT_URL`, `CORS_ORIGINS`, `DB_PATH`, `TOKEN_ENCRYPTION_KEY`.
Key client env vars: `VITE_API_URL`, `VITE_BLOSSOM_URL`.

## Architecture

### Authentication

NIP-98 HTTP Auth — the client signs kind 27235 Nostr events and sends them as `Authorization: Nostr <base64>` headers. The server middleware (`server/src/middleware/auth.ts`) verifies the signature, timestamp (±60s), URL, and method. The pubkey from the event identifies the seller.

### Encryption Flow

Files are encrypted client-side with XChaCha20-Poly1305 (`@noble/ciphers`) before upload. The encrypted blob goes to a Blossom server (BUD-02 protocol). The decryption key is stored encrypted on the Stashu server. On purchase, the buyer receives the key to decrypt the file in-browser.

### Payment Flow

1. Buyer requests a Lightning invoice or submits a Cashu token
2. Server verifies payment via the Cashu mint, swaps tokens to claim them
3. Server stores the seller's claimable Cashu token (encrypted at rest)
4. Seller withdraws earnings via Lightning (melt operation)

### Database

SQLite with WAL mode and foreign keys enabled. Schema and migrations are in `server/src/db/index.ts`. Key tables: `stashes`, `payments`, `seller_settings`, `settlement_log`, `change_proofs`, `pending_melts`.

### Crash Recovery

On startup, the server runs recovery routines: `recoverPendingMelts()` for in-flight Lightning payments and `recoverMintFailures()` for failed mint swaps. Stale payment quotes are cleaned up after 1 hour.

### API Response Format

All endpoints return `{ success: true, data: T }` or `{ success: false, error: string }`.

### Routes

Client routes: `/` (home), `/sell` (create stash), `/s/:id` (buyer unlock), `/dashboard` (seller view), `/restore` (import nsec), `/settings` (auto-settlement).

## Decision-Making Rules

Before modifying any Cashu, Nostr, or cryptography code:

1. **Check the actual spec first.** WebFetch these before writing code:
   - Cashu NUTs: `https://github.com/cashubtc/nuts` (especially NUT-00, NUT-03, NUT-04, NUT-05, NUT-11)
   - Nostr NIPs: `https://github.com/nostr-protocol/nips` (especially NIP-98, NIP-44, NIP-01)
   - Blossom BUDs: `https://github.com/hzrd149/blossom` (BUD-02 for uploads)

2. **Check installed dependency APIs.** Read the actual types in `node_modules/@cashu/cashu-ts/` — don't guess from training data. Run `npm view <pkg> version` to check if updates exist.

3. **Don't assume training data is current.** Cashu and Nostr evolve fast. If uncertain about an API or protocol detail, WebSearch or WebFetch the source of truth before proceeding.

4. **Security decisions must state the threat model.** When adding encryption, auth, or validation, always document: what it protects against, what it does NOT protect against, and what would be needed for full protection.

5. **Test roundtrips.** Any encrypt/decrypt, encode/decode, or serialize/deserialize change needs a test proving the roundtrip works.

## Encryption at Rest

All sensitive text columns are encrypted with XChaCha20-Poly1305 using `TOKEN_ENCRYPTION_KEY`. Encrypted format: `nonce:ciphertext` (hex-encoded). This protects against DB backup leaks and SQL injection reads. It does NOT protect against full server compromise (key is co-located). The v2 roadmap (NIP-44 + NUT-11 P2PK) is the path to true zero-knowledge.

Migrations use a `schema_version` table to track which migrations have run — never sniff content to detect encrypted vs plaintext.

## Before Committing Changes

For changes that touch **payment rails** (pay.ts, unlock.ts, cashu.ts, autosettle.ts, withdraw.ts, recovery.ts, db/index.ts):

1. Run `npm test` and confirm all pass
2. Manually trace the happy path: does money still flow correctly? (create stash → pay invoice → poll status → unlock → withdraw)
3. Check idempotency: can the same payment be submitted twice without double-paying?
4. Check crash recovery: if the server dies mid-payment, does recovery.ts handle it?

For changes that do **not** touch payment rails (UI, docs, logging, types, validation on non-payment fields): run `npm test` only.

## Keeping Docs Up to Date

Two different update cadences:

- **Security model docs** (README security section, known limitations): update in the same commit that changes the underlying behavior. Stale security docs are actively misleading — worse than no docs.
- **Roadmap, features, CHANGELOG**: update at the end of each phase, not every commit. Mid-phase state is incomplete and creates noise.

## Code Style

- Prettier: single quotes, semicolons, 100 char print width, trailing commas (es5)
- Pre-commit hook runs Prettier via lint-staged on `*.{ts,tsx,js,jsx,json,css,md}`
- ESLint flat config (v9) on client with React hooks and React refresh plugins
- TypeScript strict mode in both client and server

## CI

GitHub Actions on push to `main` and PRs: `npm ci` → `npm run build` → lint → prettier check. Node 22.
