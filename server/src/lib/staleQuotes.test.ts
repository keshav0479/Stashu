/**
 * Tests for cleanupStaleQuotes: Lightning payments the buyer's page never
 * polled to completion.
 *
 * A payment row only leaves 'pending' when the buyer's page polls it, so a
 * buyer who pays and then closes the tab leaves a paid quote behind. The mint
 * is mocked so each test decides what it says about a quote, and can see every
 * check, mint and swap. The rules under test: a paid quote is minted and
 * credited, an unpaid one is deleted only once its invoice has expired, a quote
 * the mint can't vouch for is kept, and nothing is ever minted twice.
 *
 * Run with: npm test --workspace=server
 */

// Set env before any db-dependent imports
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  const { randomBytes } = await import('node:crypto');
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
}
process.env.DB_PATH = ':memory:';

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

const HOUR = 3600;
const STASH = 'stash-stale';
const PRICE = 1_000;

interface QuoteStatus {
  state: string;
  expiresAt: number | null;
}

// What the mocked mint says about each quote id. A quote it has no answer for
// fails the check, the way an unreachable mint does.
const mintSays = new Map<string, QuoteStatus>();
// What each mocked mint call was asked for, in order.
const calls = {
  check: [] as string[],
  mint: [] as Array<{ amount: number; quote: string }>,
  swap: [] as number[],
};
// While set, the cleanup's quote check or a mint waits on it, so a test can
// line a buyer's poll up against it.
let checkGate: Promise<void> | null = null;
let mintGate: Promise<void> | null = null;
let mintError: Error | null = null;

mock.module('./cashu.js', {
  namedExports: {
    checkMintQuoteStatus: async (quote: string) => {
      calls.check.push(quote);
      const status = mintSays.get(quote);
      if (checkGate) await checkGate;
      if (!status) throw new Error('fetch failed');
      return status;
    },
    // The pay route's poll counts ISSUED as paid, like the real one
    checkPaymentStatus: async (quote: string) => {
      const state = mintSays.get(quote)?.state;
      return { paid: state === 'PAID' || state === 'ISSUED', issued: state === 'ISSUED' };
    },
    mintAfterPayment: async (amount: number, quote: string) => {
      calls.mint.push({ amount, quote });
      if (mintGate) await mintGate;
      if (mintError) throw mintError;
      // Like a real mint, it issues a quote's tokens once
      const status = mintSays.get(quote);
      if (status?.state !== 'PAID') throw new Error(`Quote is ${status?.state ?? 'unknown'}`);
      mintSays.set(quote, { ...status, state: 'ISSUED' });
      return `cashuMinted-${amount}`;
    },
    verifyAndSwapToken: async (_token: string, amount: number) => {
      calls.swap.push(amount);
      return { success: true, sellerToken: `cashuSeller-${amount}` };
    },
    createPaymentInvoice: async () => {
      throw new Error('not in this test');
    },
    isQuoteAlreadyIssued: () => false,
    getMeltQuote: async () => ({ success: false, error: 'not in this test' }),
    meltWithRecovery: async () => ({ success: false, error: 'not in this test' }),
    checkMeltQuoteStatus: async () => ({ state: 'UNPAID' }),
  },
});

const db = (await import('../db/index.js')).default;
const { encrypt, decrypt } = await import('./encryption.js');
const { cleanupStaleQuotes, recoverMintFailures } = await import('./recovery.js');
const { payRoutes } = await import('../routes/pay.js');

const app = new Hono();
app.route('/api/pay', payRoutes);

const now = () => Math.floor(Date.now() / 1000);
const paid = (): QuoteStatus => ({ state: 'PAID', expiresAt: now() - HOUR });
const unpaidExpired = (): QuoteStatus => ({ state: 'UNPAID', expiresAt: now() - HOUR });

function insertStash() {
  db.prepare(
    `INSERT INTO stashes (id, blob_url, secret_key, seller_pubkey, price_sats, title, file_name, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    STASH,
    encrypt('https://blossom.example.com/blob'),
    encrypt(`secret-${STASH}`),
    'stale-quote-seller',
    PRICE,
    encrypt('Title'),
    encrypt('file.zip'),
    2048
  );
}

interface QuoteRow {
  status?: string;
  ageSeconds?: number;
}

/** A Lightning payment row as the invoice route makes it, two hours old by default. */
function insertQuote(quote: string, row: QuoteRow = {}) {
  db.prepare(
    `INSERT INTO payments (id, stash_id, status, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(`ln-${quote}`, STASH, row.status ?? 'pending', quote, now() - (row.ageSeconds ?? 2 * HOUR));
}

function payment(quote: string) {
  return db.prepare('SELECT status, seller_token FROM payments WHERE id = ?').get(`ln-${quote}`) as
    | { status: string; seller_token: string | null }
    | undefined;
}

/** The seller's withdrawable balance, summed the way the balance queries sum it. */
function sellerBalance() {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(s.price_sats), 0) AS total
         FROM payments p JOIN stashes s ON p.stash_id = s.id
         WHERE p.status = 'paid' AND p.seller_token IS NOT NULL AND p.claimed = 0`
      )
      .get() as { total: number }
  ).total;
}

/** The buyer's page polling a quote. */
async function poll(quote: string) {
  const res = await app.request(`/api/pay/${STASH}/status/${quote}`);
  return (await res.json()) as {
    success: boolean;
    data?: { paid: boolean; secretKey?: string; claimToken?: string };
  };
}

/** A promise the test opens by hand. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Let pending callbacks run until `condition` holds. */
async function until(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(condition(), 'timed out waiting');
}

beforeEach(() => {
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM stashes');
  mintSays.clear();
  calls.check.length = 0;
  calls.mint.length = 0;
  calls.swap.length = 0;
  checkGate = null;
  mintGate = null;
  mintError = null;
  insertStash();
});

describe('a paid quote nobody polled', () => {
  it('is minted for the price and credited, instead of deleted', async () => {
    insertQuote('paid-unpolled');
    mintSays.set('paid-unpolled', paid());

    await cleanupStaleQuotes();

    assert.deepEqual(calls.mint, [{ amount: PRICE, quote: 'paid-unpolled' }]);
    assert.deepEqual(calls.swap, [PRICE]);
    const row = payment('paid-unpolled');
    assert.equal(row?.status, 'paid');
    assert.equal(decrypt(row?.seller_token ?? ''), `cashuSeller-${PRICE}`);
    assert.equal(sellerBalance(), PRICE);
  });

  it('can still be unlocked by the buyer polling it, without minting again', async () => {
    insertQuote('paid-then-polled');
    mintSays.set('paid-then-polled', paid());
    await cleanupStaleQuotes();

    const { data } = await poll('paid-then-polled');

    assert.equal(data?.paid, true);
    assert.equal(data?.secretKey, `secret-${STASH}`);
    assert.ok(data?.claimToken, 'the buyer gets a claim token for re-downloads');
    assert.equal(calls.mint.length, 1);
  });
});

describe('an unpaid quote', () => {
  it('is deleted once its invoice has expired', async () => {
    insertQuote('abandoned');
    mintSays.set('abandoned', unpaidExpired());

    await cleanupStaleQuotes();

    assert.equal(payment('abandoned'), undefined);
    assert.deepEqual(calls.mint, []);
  });

  it('is kept while its invoice can be paid, then settled once it expires', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    // A mint whose invoices last a day: both are still payable after an hour
    const expiresAt = now() + 22 * HOUR;
    insertQuote('paid-later');
    insertQuote('never-paid');
    mintSays.set('paid-later', { state: 'UNPAID', expiresAt });
    mintSays.set('never-paid', { state: 'UNPAID', expiresAt });

    await cleanupStaleQuotes();
    assert.equal(payment('paid-later')?.status, 'pending');
    assert.equal(payment('never-paid')?.status, 'pending');

    await cleanupStaleQuotes();
    assert.equal(calls.check.length, 2, 'not asked about again before they expire');

    // One buyer pays and closes the tab; the other never pays
    mintSays.set('paid-later', { state: 'PAID', expiresAt });
    t.mock.timers.tick((22 * HOUR + 10 * 60) * 1000);
    await cleanupStaleQuotes();

    assert.equal(calls.check.length, 4);
    assert.equal(payment('paid-later')?.status, 'paid');
    assert.equal(payment('never-paid'), undefined);
  });

  it('is kept for a few minutes past expiry, for a payment still on its way', async () => {
    insertQuote('just-expired');
    mintSays.set('just-expired', { state: 'UNPAID', expiresAt: now() - 60 });

    await cleanupStaleQuotes();

    assert.equal(payment('just-expired')?.status, 'pending');
  });

  it('expires an hour after it was made when the mint gives no expiry', async () => {
    insertQuote('no-expiry-old', { ageSeconds: 2 * HOUR });
    insertQuote('no-expiry-recent', { ageSeconds: HOUR + 60 });
    mintSays.set('no-expiry-old', { state: 'UNPAID', expiresAt: null });
    mintSays.set('no-expiry-recent', { state: 'UNPAID', expiresAt: null });

    await cleanupStaleQuotes();

    assert.equal(payment('no-expiry-old'), undefined);
    assert.equal(payment('no-expiry-recent')?.status, 'pending');
  });
});

describe('when the mint cannot vouch for a quote', () => {
  it('keeps every row while the mint is unreachable, and settles them once it is back', async () => {
    insertQuote('offline-paid');
    insertQuote('offline-unpaid');

    await cleanupStaleQuotes();

    assert.equal(calls.check.length, 2);
    assert.equal(payment('offline-paid')?.status, 'pending');
    assert.equal(payment('offline-unpaid')?.status, 'pending');
    assert.deepEqual(calls.mint, []);

    mintSays.set('offline-paid', paid());
    mintSays.set('offline-unpaid', unpaidExpired());
    await cleanupStaleQuotes();

    assert.equal(payment('offline-paid')?.status, 'paid');
    assert.equal(payment('offline-unpaid'), undefined);
  });

  it('keeps a row whose state the mint does not report', async () => {
    insertQuote('no-state');
    mintSays.set('no-state', { state: 'SOMETHING_NEW', expiresAt: now() - HOUR });

    await cleanupStaleQuotes();

    assert.equal(payment('no-state')?.status, 'pending');
    assert.deepEqual(calls.mint, []);
  });
});

describe('nothing is minted twice', () => {
  it('across repeated runs', async () => {
    insertQuote('repeat');
    mintSays.set('repeat', paid());

    await cleanupStaleQuotes();
    await cleanupStaleQuotes();

    assert.equal(calls.mint.length, 1);
    assert.equal(sellerBalance(), PRICE);
  });

  it('when a run starts while another is still going', async () => {
    insertQuote('overlap');
    mintSays.set('overlap', paid());

    await Promise.all([cleanupStaleQuotes(), cleanupStaleQuotes()]);

    assert.equal(calls.check.length, 1, 'the second call joins the run in progress');
    assert.equal(calls.mint.length, 1);
  });

  it('when the buyer polls while the cleanup is minting', async () => {
    insertQuote('race-mint');
    mintSays.set('race-mint', paid());
    const minting = gate();
    mintGate = minting.promise;

    const run = cleanupStaleQuotes();
    await until(() => calls.mint.length === 1);

    const during = await poll('race-mint');
    assert.equal(during.data?.paid, false, 'still processing, so the page keeps polling');

    minting.open();
    await run;

    const after = await poll('race-mint');
    assert.equal(after.data?.paid, true);
    assert.equal(calls.mint.length, 1);
  });

  it('when the buyer polls while the cleanup is asking the mint', async () => {
    insertQuote('race-check');
    mintSays.set('race-check', paid());
    const checking = gate();
    checkGate = checking.promise;

    const run = cleanupStaleQuotes();
    await until(() => calls.check.length === 1);

    // The buyer's page settles it first; the cleanup then acts on its PAID answer
    assert.equal((await poll('race-check')).data?.paid, true);
    checking.open();
    await run;

    assert.equal(calls.mint.length, 1, 'the cleanup must not mint what the poll settled');
    assert.equal(payment('race-check')?.status, 'paid');
  });

  it('after a crash mid-mint, whether or not the mint had issued the tokens', async () => {
    // Both rows were 'processing' when the server died
    insertQuote('crashed-before-mint', { status: 'processing' });
    insertQuote('crashed-after-mint', { status: 'processing' });
    mintSays.set('crashed-before-mint', paid());
    mintSays.set('crashed-after-mint', { state: 'ISSUED', expiresAt: now() - HOUR });

    // The first run only resets them: a row 'processing' could be a poll
    // minting it right now, and that poll must be the only one acting on it
    await cleanupStaleQuotes();
    assert.deepEqual(calls.check, []);
    assert.equal(payment('crashed-before-mint')?.status, 'pending');

    await cleanupStaleQuotes();

    assert.equal(payment('crashed-before-mint')?.status, 'paid');
    // Its tokens were lost in the crash: flag it, as a buyer's poll would
    assert.equal(payment('crashed-after-mint')?.status, 'mint_failed');
    assert.deepEqual(
      calls.mint.map((c) => c.quote),
      ['crashed-before-mint']
    );
  });

  it('when minting fails: startup recovery retries it, and it is never deleted', async () => {
    insertQuote('mint-error');
    mintSays.set('mint-error', paid());
    mintError = new Error('mint timed out');

    await cleanupStaleQuotes();
    assert.equal(payment('mint-error')?.status, 'mint_failed');

    await cleanupStaleQuotes();
    assert.equal(calls.mint.length, 1, 'the cleanup leaves it to startup recovery');

    mintError = null;
    await recoverMintFailures();
    assert.equal(payment('mint-error')?.status, 'paid');
    assert.equal(sellerBalance(), PRICE);
  });
});

describe('what the cleanup leaves alone', () => {
  it('resets processing rows a crash left behind, but not ones being minted now', async () => {
    insertQuote('stuck', { status: 'processing', ageSeconds: 10 * 60 });
    insertQuote('in-flight', { status: 'processing', ageSeconds: 60 });

    await cleanupStaleQuotes();

    assert.equal(payment('stuck')?.status, 'pending');
    assert.equal(payment('in-flight')?.status, 'processing');
    assert.deepEqual(calls.check, [], 'neither is an hour old, so the buyer may still poll');
  });

  it('ignores quotes under an hour old and Cashu token payments', async () => {
    insertQuote('fresh', { ageSeconds: 30 * 60 });
    const tokenHash = 'a'.repeat(64);
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, created_at)
       VALUES (?, ?, 'pending', ?, ?)`
    ).run(`${STASH}-${tokenHash}`, STASH, tokenHash, now() - 2 * HOUR);

    await cleanupStaleQuotes();

    assert.deepEqual(calls.check, []);
    assert.equal(payment('fresh')?.status, 'pending');
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n,
      2,
      'nothing deleted'
    );
  });
});
