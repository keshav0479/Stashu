import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Zap,
  Key,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Squirrel,
  XCircle,
  LockOpen,
  Package,
  Download,
} from 'lucide-react';
import { useUnlock } from '../lib/useUnlock';
import { createPayInvoice, checkPayStatus } from '../lib/api';

type PayTab = 'lightning' | 'cashu';

export function UnlockPage() {
  const { id } = useParams<{ id: string }>();
  const unlock = useUnlock(id || '');
  const [token, setToken] = useState('');
  const [tab, setTab] = useState<PayTab>('lightning');

  // Lightning payment state
  const [invoice, setInvoice] = useState<string | null>(null);
  const [lnLoading, setLnLoading] = useState(false);
  const [lnError, setLnError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (id) {
      unlock.loadStash();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unlock.loadStash]);

  // Cleanup polling and timer on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleLnUnlock = useCallback(
    (data: { secretKey: string; blobUrl: string; fileName?: string }) => {
      // Use the unlock hook's internal mechanism to handle decryption
      unlock.submitLightningResult(data);
    },
    [unlock]
  );

  // Helper: start timer + polling for a given invoice session
  const startTimerAndPolling = useCallback(
    (invoiceStr: string, quoteId: string, expiresAt: number) => {
      setInvoice(invoiceStr);

      if (id) {
        sessionStorage.setItem(
          `stashu-invoice-${id}`,
          JSON.stringify({ invoice: invoiceStr, quoteId, expiresAt })
        );
      }

      // Start countdown timer
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const remaining = expiresAt - Math.floor(Date.now() / 1000);
        setTimeLeft(remaining > 0 ? remaining : 0);
        if (remaining <= 0) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (id) sessionStorage.removeItem(`stashu-invoice-${id}`);
        }
      }, 1000);

      // Start polling
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const status = await checkPayStatus(id!, quoteId);
          if (status.paid && status.secretKey && status.blobUrl) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
            pollRef.current = null;
            timerRef.current = null;
            if (id) sessionStorage.removeItem(`stashu-invoice-${id}`);
            handleLnUnlock({
              secretKey: status.secretKey,
              blobUrl: status.blobUrl,
              fileName: status.fileName,
            });
          }
        } catch (err) {
          // Terminal server errors (e.g. mint_failed) — stop polling, show error
          if (err instanceof Error && err.message.includes('failed')) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
            pollRef.current = null;
            timerRef.current = null;
            setLnError(err.message);
          }
          // Transient errors (network blip etc.) — silently retry on next poll
        }
      }, 2500);
    },
    [id, handleLnUnlock]
  );

  const createInvoice = useCallback(async () => {
    if (!id) return;
    setLnLoading(true);
    setLnError(null);

    try {
      const result = await createPayInvoice(id);
      startTimerAndPolling(result.invoice, result.quoteId, result.expiresAt);
    } catch (err) {
      setLnError(err instanceof Error ? err.message : 'Failed to create invoice');
    } finally {
      setLnLoading(false);
    }
  }, [id, startTimerAndPolling]);

  // Auto-create or resume invoice when Lightning tab is active and stash is loaded
  useEffect(() => {
    if (tab !== 'lightning' || !unlock.stash || invoice || lnLoading || unlock.status !== 'ready') {
      return;
    }

    // Try to resume a persisted invoice from sessionStorage
    if (id) {
      try {
        const saved = sessionStorage.getItem(`stashu-invoice-${id}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          const remaining = parsed.expiresAt - Math.floor(Date.now() / 1000);
          if (remaining > 10) {
            // Resume polling the existing invoice
            startTimerAndPolling(parsed.invoice, parsed.quoteId, parsed.expiresAt);
            return;
          } else {
            // Expired — clean up
            sessionStorage.removeItem(`stashu-invoice-${id}`);
          }
        }
      } catch {
        // Corrupted storage — ignore
      }
    }

    createInvoice();
  }, [
    tab,
    unlock.stash,
    invoice,
    lnLoading,
    unlock.status,
    id,
    createInvoice,
    startTimerAndPolling,
  ]);

  const refreshInvoice = () => {
    setInvoice(null);
    setTimeLeft(null);
    setLnError(null);
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (id) sessionStorage.removeItem(`stashu-invoice-${id}`);
    createInvoice();
  };

  const formatCountdown = (seconds: number): string => {
    if (seconds >= 3600) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const copyInvoice = async () => {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Loading state
  if (unlock.status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-amber-500/20 rounded-2xl flex items-center justify-center animate-pulse">
            <Squirrel className="w-8 h-8 text-amber-400" />
          </div>
          <p className="text-slate-400">Loading stash...</p>
        </div>
      </div>
    );
  }

  // Error loading stash
  if (unlock.status === 'error' && !unlock.stash) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 mx-auto mb-6 bg-rose-500/20 rounded-2xl flex items-center justify-center">
            <XCircle className="w-10 h-10 text-rose-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">Stash Not Found</h1>
          <p className="text-slate-400 mb-8">
            {unlock.error || 'This stash may have been removed or the link is invalid.'}
          </p>
          <Link
            to="/"
            className="inline-block py-3 px-6 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // Success state - file ready to download
  if (unlock.status === 'done') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-lg w-full text-center">
          <div className="w-20 h-20 mx-auto mb-6 bg-emerald-500/20 rounded-2xl flex items-center justify-center">
            <LockOpen className="w-10 h-10 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">Unlocked!</h1>
          <p className="text-slate-400 mb-8">Your file is ready to download.</p>

          <button
            onClick={() => unlock.download()}
            className="w-full py-4 px-6 bg-green-500 hover:bg-green-600 text-white font-bold text-lg rounded-xl transition-colors mb-4 flex items-center justify-center gap-2"
          >
            <Download className="w-5 h-5" />
            Download File
          </button>

          <Link to="/" className="block text-slate-400 hover:text-white transition-colors">
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Main unlock form
  return (
    <div className="min-h-screen bg-slate-900 py-12 px-6">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <Link
          to="/"
          className="inline-flex items-center text-slate-400 hover:text-white mb-8 transition-colors"
        >
          ← Back
        </Link>

        {/* Stash Info Card */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-orange-500/20 rounded-2xl flex items-center justify-center">
            <Package className="w-8 h-8 text-orange-400" />
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2">{unlock.stash?.title}</h1>
          {unlock.stash?.description && (
            <p className="text-slate-400 text-center mb-6">{unlock.stash.description}</p>
          )}

          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="bg-slate-900/50 rounded-xl p-4">
              <p className="text-slate-500 text-sm mb-1">Size</p>
              <p className="text-white font-semibold">
                {unlock.stash ? formatFileSize(unlock.stash.fileSize) : '—'}
              </p>
            </div>
            <div className="bg-slate-900/50 rounded-xl p-4">
              <p className="text-slate-500 text-sm mb-1">Price</p>
              <p className="text-orange-400 font-bold text-xl">{unlock.stash?.priceSats} sats</p>
            </div>
          </div>
        </div>

        {/* Payment Tabs */}
        <div className="flex mb-6 bg-slate-800/50 rounded-xl p-1">
          <button
            onClick={() => setTab('lightning')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all text-sm ${
              tab === 'lightning'
                ? 'bg-amber-500 text-white shadow-lg'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Zap className="w-4 h-4" />
            Pay with Lightning
          </button>
          <button
            onClick={() => setTab('cashu')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all text-sm ${
              tab === 'cashu'
                ? 'bg-orange-500 text-white shadow-lg'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Key className="w-4 h-4" />
            Pay with Cashu
          </button>
        </div>

        {/* Lightning Tab */}
        {tab === 'lightning' && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
            {lnLoading && !invoice && (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 text-amber-400 animate-spin mx-auto mb-3" />
                <p className="text-slate-400 text-sm">Creating Lightning invoice...</p>
              </div>
            )}

            {lnError && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 mb-4">
                <p className="text-rose-400 text-sm">{lnError}</p>
                <button onClick={createInvoice} className="mt-2 text-sm text-amber-400 underline">
                  Try again
                </button>
              </div>
            )}

            {invoice && (
              <>
                {/* QR Code */}
                <div className="flex justify-center mb-4">
                  <a
                    href={`lightning:${invoice}`}
                    className="bg-white p-4 rounded-2xl block hover:shadow-lg hover:shadow-amber-500/20 transition-shadow"
                  >
                    <QRCodeSVG
                      value={invoice.toUpperCase()}
                      size={240}
                      level="M"
                      includeMargin={false}
                    />
                  </a>
                </div>

                {/* Expiry countdown */}
                {timeLeft !== null && timeLeft > 0 && (
                  <p className="text-center text-slate-500 text-xs mb-3">
                    Expires in{' '}
                    <span className={timeLeft < 60 ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                      {formatCountdown(timeLeft)}
                    </span>
                  </p>
                )}

                {/* Expired state */}
                {timeLeft !== null && timeLeft <= 0 && (
                  <div className="text-center mb-4">
                    <p className="text-rose-400 text-sm mb-2">Invoice expired</p>
                    <button
                      onClick={refreshInvoice}
                      className="inline-flex items-center gap-2 py-2 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      New Invoice
                    </button>
                  </div>
                )}

                {/* Not expired — show action buttons */}
                {(timeLeft === null || timeLeft > 0) && (
                  <>
                    <p className="text-center text-slate-400 text-sm mb-4">
                      Scan with any Lightning wallet to pay
                    </p>

                    {/* Open in wallet + Copy buttons */}
                    <div className="flex gap-2 mb-3">
                      <a
                        href={`lightning:${invoice}`}
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 rounded-xl transition-colors text-sm text-amber-400 font-medium"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open in Wallet
                      </a>
                      <button
                        onClick={copyInvoice}
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-900 border border-slate-700 hover:border-amber-500/50 rounded-xl transition-colors text-sm"
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4 text-green-400" />
                            <span className="text-green-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 text-slate-400" />
                            <span className="text-slate-400">Copy Invoice</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Waiting indicator */}
                    <div className="flex items-center justify-center gap-2 text-amber-400 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Waiting for payment...
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Cashu Tab */}
        {tab === 'cashu' && (
          <>
            <div className="mb-6">
              <label className="block text-slate-300 mb-2 font-medium">
                Paste your Cashu token
              </label>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="cashuA..."
                rows={4}
                disabled={unlock.status === 'unlocking' || unlock.status === 'decrypting'}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-600 
                         rounded-xl text-white placeholder-slate-500 font-mono text-sm
                         focus:outline-none focus:border-orange-500 resize-none
                         disabled:opacity-50"
              />
              <p className="text-slate-500 text-sm mt-2">
                Get tokens from{' '}
                <a
                  href="https://nutstash.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-400 underline"
                >
                  Nutstash
                </a>{' '}
                or{' '}
                <a
                  href="https://www.minibits.cash"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-400 underline"
                >
                  Minibits
                </a>
              </p>
            </div>

            {/* Unlock Button */}
            <button
              onClick={() => unlock.submitToken(token)}
              disabled={
                !token.trim() || unlock.status === 'unlocking' || unlock.status === 'decrypting'
              }
              className="w-full py-4 px-6 bg-orange-500 hover:bg-orange-600 
                       text-white font-bold text-lg rounded-xl transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {unlock.status === 'unlocking' || unlock.status === 'decrypting'
                ? 'Processing...'
                : `Unlock for ${unlock.stash?.priceSats} sats`}
            </button>
          </>
        )}

        {/* Error Display (shared) */}
        {unlock.error && (
          <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <p className="text-red-400">{unlock.error}</p>
          </div>
        )}

        {/* Progress Display (shared) */}
        {(unlock.status === 'unlocking' || unlock.status === 'decrypting') && (
          <div
            ref={(el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="mt-6 bg-slate-800/50 border border-orange-500/30 rounded-xl p-5"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                <Key className="w-5 h-5 text-orange-400 animate-pulse" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">
                  {unlock.status === 'unlocking' ? 'Verifying payment...' : 'Decrypting file...'}
                </p>
                <p className="text-slate-500 text-xs">This may take a moment</p>
              </div>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-linear-to-r from-orange-500 via-amber-400 to-orange-500 rounded-full animate-pulse"
                style={{
                  width: unlock.status === 'decrypting' ? '80%' : '40%',
                  transition: 'width 1s ease-in-out',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
