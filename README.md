<div align="center">
  <h1>🐿️ Stashu</h1>
  <p>
    <strong>Trust-Minimized Digital Asset Exchange Protocol</strong>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Protocol-Nostr%20(NIP--98)-purple" alt="Nostr">
    <img src="https://img.shields.io/badge/Payment-Cashu%20(NIP--60)-orange" alt="Cashu">
    <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  </p>
</div>

---

## Overview

**Stashu** is a decentralized application designed to facilitate the private exchange of digital files for e-cash. It eliminates the need for trusted intermediaries by leveraging cryptographic proofs and distributed storage protocols.

The system functions as a trust-minimized "Atomic Exchange":
1.  **Storage:** Files are encrypted client-side and stored on **Blossom Servers (NIP-98)**.
2.  **Payments:** Transactions are settled using **Cashu (NIP-60)** blind signatures, ensuring payer privacy.
3.  **Exchange:** The decryption key is cryptographically locked and released only upon verification of a valid Cashu token proof.

## Architecture

Stashu integrates three distinct protocols to ensure privacy and data sovereignty:

| Component | Standard | Function |
| :--- | :--- | :--- |
| **Storage Layer** | **NIP-98 (Blossom)** | HTTP Authentication using Nostr events for authenticated file uploads. |
| **Encryption** | **NIP-44** | XChaCha20-Poly1305 encryption. Keys are generated client-side and never exposed to storage providers. |
| **Settlement** | **NIP-60 (Cashu)** | Chaumian E-Cash integration for blind, instant, and effectively zero-fee payments. |

## Features

* **Client-Side Encryption:** All file encryption occurs in the browser. The storage provider hosts only opaque binary blobs.
* **Blind Atomic Swaps:** The payment server verifies the validity of the e-cash token before releasing the decryption key, preventing double-spending without tracking user identity.
* **No Accounts Required:** Authentication is handled via public/private key pairs (Nostr), removing the need for email or password databases.

## 📦 Installation & Setup

*(Currently in active development)*
