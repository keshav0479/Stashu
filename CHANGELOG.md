# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Public machine-readable manifest endpoint per stash
- Configurable per-stash re-download window, so sellers decide how long a buyer can come back

### Changed

- Verified Peek is now bound to the sealed stash package, so a preview cannot be swapped for one taken from different content
- Blossom uploads pick a server that accepts encrypted blobs and fail over when one rejects them; primal is kept as a download fallback for stashes uploaded before the switch

### Fixed

- Unresponsive Cashu mints now time out instead of leaving buyers waiting indefinitely
- Sealed blobs are cached by hash rather than re-fetched
- Settings page works out its initial state upfront instead of rendering once and then filling it in

### Security

- Unlock tokens that do not credit exactly the asking price are rejected before the swap, closing an over- and under-payment gap
- Request and response size limits on the server and on LNURL responses, guarding against memory-exhaustion DoS
- SSRF checks on server-side fetches
- Dependency updates covering an IP-restriction bypass in Hono and an open redirect in React Router

## [0.2.0] - 2026-04-28

Verified Peek, seller storefronts, and encryption at rest for every sensitive column.

### Added

- **Verified Peek** — sellers can reveal a slice of a text file before payment, backed by proof commitments so buyers can check the preview really came from the file they are buying
- **Deterministic stash previews** generated from the source file rather than supplied separately
- **Public seller storefront** with per-stash visibility controls
- **Blossom server selection** with BUD-04 mirroring and a download fallback

### Changed

- Every sensitive DB column is encrypted with XChaCha20-Poly1305 using `TOKEN_ENCRYPTION_KEY`
- Downloads verify the stash before decrypting
- Smoother Verified Peek flow, including its fallback state, and primary action styling unified across the app

### Security

- Encrypt `secret_key` (file decryption key) at rest — DB dumps can no longer decrypt uploaded files
- Encrypt stash metadata (`title`, `description`, `file_name`) at rest
- Encrypt Lightning addresses in `seller_settings` and `settlement_log` at rest — DB dumps can no longer deanonymize sellers
- Replace content-sniffing migrations with a versioned `schema_version` table — deterministic, and safe for all data types
- Validate `blobSha256` format and tighten the localhost check

### Fixed

- Stash visibility is gated by the storefront setting, and storefront toggles are disabled when the storefront is off
- Storefront link is hidden when disabled; the privacy note always shows

## [0.1.0] - 2026-03-10

Initial release. Stashu V1 is a working pay-to-unlock file marketplace with trusted escrow.

### Added

- **Seller flow** — Local Nostr keypair generation, drag-and-drop file upload, client-side XChaCha20-Poly1305 encryption, Blossom (BUD-02) storage, stash creation with NIP-98 auth
- **Buyer flow** — Preview page, Cashu token paste unlock, Lightning QR payment, token verification/swap, decryption key release, client-side decrypt + download
- **Lightning payments** — Invoice QR with expiry countdown, mint quote polling, server-side minting, auto-download on payment
- **Lightning withdrawal** — One-click melt-to-BOLT11, LN address resolution (LUD-16), token aggregation, fee estimation, settlement history modal
- **Auto-settlement** — Configurable threshold, automatic LN address payout, settlement logging
- **Seller dashboard** — Earnings display, stash stats, withdrawal, settlement history
- **Account recovery** — nsec backup and restore flow
- **Security** — NIP-98 Schnorr auth on seller endpoints, rate limiting, anti-replay quote binding, atomic processing lock, stale quote cleanup, stuck-processing recovery
- **Payment recovery** — Change proof persistence + reuse, pending melt tracking, mint failure auto-retry on startup
- **Token encryption** — XChaCha20-Poly1305 encryption of seller tokens at rest
- **Infrastructure** — Docker + Docker Compose, GitHub Actions CI (build + lint + format), OG meta tags, custom 404 page
- **UI** — "How it Works" section, file previews, skeleton loading states, toast notifications, mobile-responsive layout
