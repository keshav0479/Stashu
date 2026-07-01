<div align="center">
  <img src="client/src/assets/logo.png" alt="Stashu Logo" width="120">
  <h1>Stashu</h1>
  <p>
    <strong>Sell encrypted files for sats with previews buyers can verify.</strong>
  </p>
  <p>
    <a href="https://stashu.tech">Website</a> &middot;
    <a href="#how-it-works">How it works</a> &middot;
    <a href="#verified-peek">Verified Peek</a> &middot;
    <a href="#security-model">Security</a>
  </p>
</div>

---

## Why Stashu?

Stashu is a privacy-first pay-to-unlock file marketplace. Sellers create a stash
in the browser, buyers unlock it with Lightning or Cashu ecash, and no platform
account is required.

- **Client-side sealing** - hidden file regions are encrypted in the browser
  before upload. Any seller-selected preview is intentionally public.
- **Blossom storage** - sealed blobs are stored on Blossom servers instead of
  inside the app database.
- **Verified Peek** - optional previews are generated from the file itself and
  checked again after unlock.
- **Nostr seller identity** - sellers use a local Nostr keypair and NIP-98 auth,
  with no passwords or sessions.
- **Sats-native unlocks** - buyers can pay with a Lightning invoice or a Cashu
  token.
- **Self-hostable** - run the client, server, database, and preferred Blossom
  setup yourself.

## How It Works

<div align="center">
  <img src="docs/stashu-architecture.png" alt="Stashu architecture" width="900">
</div>

1. **Seller creates a stash** - selects a file, title, price, and optional buyer
   preview.
2. **Browser seals the file** - hidden plaintext stays local. New stashes are
   packed into an authenticated selective-reveal blob and uploaded to Blossom.
3. **Server stores stash state** - encrypted metadata, payment state, and preview
   proof data are saved in SQLite.
4. **Buyer opens the stash** - public metadata and any Verified Peek data are
   loaded before payment. When a public peek exists, the buyer also fetches and
   hash-checks the sealed Blossom blob before payment is enabled.
5. **Buyer pays** - either by paying a Lightning invoice or pasting a Cashu ecash
   token.
6. **Browser unlocks the file** - after payment, the server returns the decryption
   material, and the buyer browser decrypts and verifies the download locally. The
   buyer can re-download on the same device until the seller's re-download window
   ends.

## Verified Peek

Verified Peek adds a buyer-side integrity check. If a seller shows text publicly,
the new sealed blob stores that exact excerpt as a public segment between
encrypted hidden segments. The buyer fetches and hash-checks the sealed blob
before payment, then reconstructs and verifies the complete file after unlock.
New text peeks require this v2 sealed-package flow. Existing v1 links remain
unlockable, but the buyer page labels their weaker prepayment assurance as
`Legacy Peek`.

<div align="center">
  <img src="docs/verified-peek.png" alt="Verified Peek flow" width="900">
</div>

What it gives buyers:

- Preview text is generated from the selected file in the seller's browser.
- The buyer page checks the published preview proof and sealed Blossom blob
  before enabling payment.
- The public excerpt is a literal segment used when reconstructing the locked
  file, rather than a detached text sample.
- After payment, the decrypted file is checked against the same content
  commitment before the download is shown as verified.
- If the preview proof or unlocked file does not match, Stashu blocks payment or
  marks the download as not verified.

Under the hood:

- The browser serializes the generated preview and hashes it.
- Hidden file regions are encrypted with XChaCha20-Poly1305. The public excerpt,
  when present, is stored as a plaintext region in the sealed blob.
- The exact sealed blob is addressed and checked by its SHA-256 hash.
- The reconstructed file is committed with a Merkle-style root over file chunks.
- If text is shown publicly, that exact range gets an inclusion proof.
- V2 proof roots tie the preview hash, reconstructed content root, and sealed
  blob hash together.
- The server stores the proof data, but the proof secret needed for the final file
  check is returned only after unlock.

For now, public previews are generated for text-like files. Other file types still
get a no-public-preview commitment check after unlock.

## Tech Stack

| Layer      | Technology                                |
| ---------- | ----------------------------------------- |
| Frontend   | React 19, Vite, TypeScript, TailwindCSS 4 |
| Backend    | Hono, TypeScript, better-sqlite3          |
| Database   | SQLite with WAL mode and foreign keys     |
| Storage    | Blossom                                   |
| Encryption | XChaCha20-Poly1305 with `@noble/ciphers`  |
| Payments   | Cashu ecash and Lightning                 |
| Identity   | Local Nostr keypair with nsec recovery    |
| Auth       | NIP-98 HTTP Auth                          |

## Security Model

Stashu V1 is a trusted escrow. In the normal flow, hidden plaintext stays
client-side, but the server still coordinates payment and returns the file key
after a valid unlock.

### Protected Today

- **Hidden file contents** stay in the seller and buyer browsers during normal
  use. Blossom stores encrypted hidden regions plus any intentionally public
  preview excerpt.
- **Sensitive database fields** are encrypted at rest, including stash metadata,
  blob URLs, file keys, preview proof fields, seller payment tokens, and Lightning
  addresses.
- **Verified Peek integrity** checks that a public text excerpt is a literal
  segment of the hash-verified sealed blob before payment, then checks the
  reconstructed file against its content commitment after unlock.
- **Seller auth** uses NIP-98 signatures from the seller's local Nostr keypair.
- **Payment integrity** uses quote-to-stash binding, processing locks, and
  idempotent unlock paths to guard against replay and double-processing bugs.
- **Rate limiting** protects public unlock, payment, stash, and seller routes.

### Known Limits

| Limit                  | Details                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trusted server         | The server currently stores encrypted file keys and decides when to release them after payment.                                                                                                                                                                          |
| Server compromise      | `TOKEN_ENCRYPTION_KEY` is co-located with the database. A root compromise can decrypt encrypted database fields.                                                                                                                                                         |
| Payment custody        | Seller Cashu tokens are held by the server until withdrawal or auto-settlement.                                                                                                                                                                                          |
| Browser key storage    | The seller Nostr private key lives in browser local storage.                                                                                                                                                                                                             |
| Preview privacy        | Verified Peek reveals the selected preview before payment. Stashu uses conservative defaults and limits, but the seller still chooses what to show.                                                                                                                      |
| Seller quality         | Verified Peek proves that the public excerpt is used by the locked package. It cannot prove before unlock that hidden regions are useful, representative, or decrypt successfully. A dishonest seller can still sell low-quality content or deliberately break delivery. |
| Prepayment bandwidth   | Sealed blobs with a public peek are fetched and hash-checked before payment so the buyer can verify the locked package. Large previewed files therefore consume download bandwidth before unlock.                                                                        |
| Single mint dependency | The server currently uses one configured Cashu mint through `MINT_URL`.                                                                                                                                                                                                  |
| Re-download window     | Buyers re-download with a per-device claim token in browser local storage that expires after the seller's window (1-30 days, default 7). It is not a shareable link, so clearing the browser ends re-download access.                                                    |

## Quick Start

```bash
git clone https://github.com/keshav0479/Stashu.git
cd Stashu
npm install

cp server/.env.example server/.env
# Generate TOKEN_ENCRYPTION_KEY:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

cp client/.env.example client/.env

npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3000

## Environment

Server:

- `TOKEN_ENCRYPTION_KEY` - 64 hex chars. Required.
- `MINT_URL` - Cashu mint URL.
- `CASHU_REQUEST_TIMEOUT_MS` - abort unresponsive mint requests. Defaults to `10000`.
- `CORS_ORIGINS` - comma-separated allowed origins.
- `PORT` - server port. Defaults to `3000`.
- `DB_PATH` - SQLite database path.
- `TRUSTED_PROXY` - set to `1` only when running behind a trusted proxy.
- `ALLOW_INSECURE_BLOSSOM_URLS` - set to `1` only for intentional local development with
  HTTP or private-network Blossom URLs.

Client:

- `VITE_API_URL` - server API URL.
- `VITE_BLOSSOM_URL` - default Blossom server URL.

## Development

```bash
# Run client and server
npm run dev

# Build both workspaces
npm run build

# Run all tests
npm run test

# Run one side
npm run test --workspace=server
npm run test --workspace=client
npm run lint --workspace=client

# Docker
docker compose up --build
```

## Roadmap

### V1: Trusted Escrow

- [x] Client-side file encryption
- [x] Blossom-backed encrypted file storage
- [x] Cashu and Lightning unlocks
- [x] Nostr keypair seller auth
- [x] Seller dashboard, withdrawal, and auto-settlement
- [x] Storefront publishing controls
- [x] Verified Peek for text-like files
- [ ] Rich previews for images, PDFs, and archives
- [ ] Stash lifecycle controls for editing, unpublishing, and deleting
- [ ] Clearer fee estimates before withdrawal

### V2: Trust-Minimized

- [ ] **NIP-44 key exchange** - move file-key delivery away from server-readable
      escrow.
- [ ] **NUT-11 P2PK tokens** - lock Cashu payments to the seller's key so the
      server cannot spend seller funds.
- [ ] **Multi-mint support** - let buyers and sellers work across more than one
      configured mint.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, testing, and PR
guidelines.

## License

MIT
