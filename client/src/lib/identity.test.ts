/**
 * Tests for Nostr identity management (keypair creation, nsec import/export).
 *
 * Run with: npm test --workspace=client
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrCreateIdentity,
  hasIdentity,
  importFromRecoveryToken,
  clearIdentity,
  getPublicKeyHex,
  getRecoveryToken,
} from './identity.js';

beforeEach(() => {
  clearIdentity();
});

describe('getOrCreateIdentity', () => {
  it('creates a new identity when none exists', () => {
    const id = getOrCreateIdentity();
    expect(id.nsec).toMatch(/^nsec1/);
    expect(id.npub).toMatch(/^npub1/);
    expect(id.secretKey).toBeInstanceOf(Uint8Array);
    expect(id.secretKey.length).toBe(32);
    expect(id.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same identity on repeated calls', () => {
    const id1 = getOrCreateIdentity();
    const id2 = getOrCreateIdentity();
    expect(id1.nsec).toBe(id2.nsec);
    expect(id1.publicKey).toBe(id2.publicKey);
  });

  it('persists identity to localStorage', () => {
    expect(hasIdentity()).toBe(false);
    getOrCreateIdentity();
    expect(hasIdentity()).toBe(true);
  });
});

describe('clearIdentity', () => {
  it('removes the stored identity', () => {
    getOrCreateIdentity();
    expect(hasIdentity()).toBe(true);
    clearIdentity();
    expect(hasIdentity()).toBe(false);
  });

  it('creates a fresh keypair after clearing', () => {
    const id1 = getOrCreateIdentity();
    clearIdentity();
    const id2 = getOrCreateIdentity();
    expect(id1.publicKey).not.toBe(id2.publicKey);
  });
});

describe('importFromRecoveryToken', () => {
  it('imports a valid nsec and restores the same pubkey', () => {
    const original = getOrCreateIdentity();
    const nsec = original.nsec;
    clearIdentity();

    const result = importFromRecoveryToken(nsec);
    expect(result.success).toBe(true);

    const restored = getOrCreateIdentity();
    expect(restored.publicKey).toBe(original.publicKey);
    expect(restored.nsec).toBe(nsec);
  });

  it('rejects a string that does not start with nsec1', () => {
    const result = importFromRecoveryToken('npub1abc');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nsec1/);
  });

  it('rejects garbage input', () => {
    const result = importFromRecoveryToken('not-a-key');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('getPublicKeyHex', () => {
  it('returns a 64-character hex string', () => {
    expect(getPublicKeyHex()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('getRecoveryToken', () => {
  it('returns an nsec1... bech32 string', () => {
    expect(getRecoveryToken()).toMatch(/^nsec1/);
  });

  it('round-trips: import the exported nsec restores same pubkey', () => {
    const pk = getPublicKeyHex();
    const nsec = getRecoveryToken();
    clearIdentity();

    importFromRecoveryToken(nsec);
    expect(getPublicKeyHex()).toBe(pk);
  });
});
