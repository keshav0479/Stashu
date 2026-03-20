# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security

- Encrypt `secret_key` (file decryption key) at rest — DB dumps can no longer decrypt uploaded files
- Encrypt stash metadata (`title`, `description`, `file_name`) at rest
- Encrypt Lightning addresses in `seller_settings` and `settlement_log` at rest — DB dumps can no longer deanonymize sellers
- Replace content-sniffing migrations with versioned `schema_version` table — deterministic, safe for all data types

### Changed

- All sensitive DB columns now encrypted with XChaCha20-Poly1305 (`TOKEN_ENCRYPTION_KEY`)

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
