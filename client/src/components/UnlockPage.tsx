import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
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
  FileText,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useUnlock } from '../lib/useUnlock';
import { createPayInvoice, checkPayStatus } from '../lib/api';
import { verifyGeneratedPreviewBundle } from '../lib/verifiedPreview';
import type { StashProofSecret, TextPreviewMetadata } from '../../../shared/types';

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
  const [showVerificationDetails, setShowVerificationDetails] = useState(false);
  const [proofRootCopied, setProofRootCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewVerification = useMemo(
    () => verifyGeneratedPreviewBundle(unlock.stash?.generatedPreview, unlock.stash?.previewProof),
    [unlock.stash?.generatedPreview, unlock.stash?.previewProof]
  );
  const previewStats = useMemo(() => {
    if (!unlock.stash?.generatedPreview || unlock.stash.generatedPreview.kind !== 'text-peek') {
      return null;
    }

    const metadata = unlock.stash.generatedPreview.metadata as TextPreviewMetadata;
    const percent =
      unlock.stash.generatedPreview.fileSize > 0
        ? Math.round((metadata.previewBytes / unlock.stash.generatedPreview.fileSize) * 1000) / 10
        : 0;

    return {
      bytes: metadata.previewBytes,
      lines: metadata.linesIncluded,
      percent,
    };
  }, [unlock.stash?.generatedPreview]);
  const previewProofInvalid = previewVerification.state === 'invalid';

  useEffect(() => {
    if (id) {
      unlock.loadStash();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unlock.loadStash]);

  // After stash loads, try to recover a previous payment via claim token
  const claimAttempted = useRef(false);
  useEffect(() => {
    claimAttempted.current = false;
  }, [id]);
  useEffect(() => {
    if ((unlock.status === 'ready' || unlock.status === 'claiming') && !claimAttempted.current) {
      claimAttempted.current = true;
      unlock.tryClaimToken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlock.status, unlock.tryClaimToken]);

  // Cleanup polling and timer on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleLnUnlock = useCallback(
    (data: {
      secretKey: string;
      blobUrl: string;
      blobSha256?: string;
      fileName?: string;
      claimToken?: string;
      previewSecret?: StashProofSecret;
    }) => {
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
              blobSha256: status.blobSha256,
              fileName: status.fileName,
              claimToken: status.claimToken,
              previewSecret: status.previewSecret,
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
    if (previewProofInvalid) {
      setLnError('Preview verification failed. Payment is disabled for this stash.');
      return;
    }
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
  }, [id, previewProofInvalid, startTimerAndPolling]);

  // Auto-create or resume invoice when Lightning tab is active and stash is loaded
  useEffect(() => {
    if (
      tab !== 'lightning' ||
      !unlock.stash ||
      invoice ||
      lnLoading ||
      unlock.status !== 'ready' ||
      !claimAttempted.current ||
      previewProofInvalid
    ) {
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
    previewProofInvalid,
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

  const copyProofRoot = async () => {
    const proofRoot = unlock.stash?.previewProof?.root;
    if (!proofRoot) return;

    try {
      await navigator.clipboard.writeText(proofRoot);
      setProofRootCopied(true);
      setTimeout(() => setProofRootCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const shortHash = (hash: string): string => `${hash.slice(0, 12)}...${hash.slice(-12)}`;

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

  // Checking previous payment via claim token (covers both the API call and file decryption)
  if (unlock.status === 'claiming' || (unlock.status === 'decrypting' && !invoice && !token)) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-amber-500/20 rounded-2xl flex items-center justify-center animate-pulse">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
          <p className="text-slate-400">
            {unlock.status === 'claiming' ? 'Checking previous payment...' : 'Decrypting file...'}
          </p>
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
          <Link to="/" className="btn-primary px-6 py-3">
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

          {unlock.stash?.previewProof && (
            <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
                <p className="font-semibold text-emerald-300">Download verified</p>
              </div>
              <p className="text-sm text-emerald-50/70">
                The decrypted file matched the same commitment checked before payment.
              </p>
              <button
                type="button"
                onClick={() => setShowVerificationDetails((value) => !value)}
                className="mt-3 text-sm font-medium text-emerald-300 transition-colors hover:text-emerald-100"
              >
                {showVerificationDetails ? 'Hide verification details' : 'Verification details'}
              </button>

              {showVerificationDetails && (
                <div className="soft-appear mt-4 space-y-3 rounded-lg border border-emerald-500/20 bg-slate-950/40 p-3">
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-slate-500">Preview proof</p>
                      <p className="font-medium text-emerald-200">Verified</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Unlocked file</p>
                      <p className="font-medium text-emerald-200">Matched</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">File size</p>
                      <p className="font-medium text-slate-200">
                        {formatFileSize(unlock.stash.fileSize)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Public peek</p>
                      <p className="font-medium text-slate-200">
                        {previewStats
                          ? `${previewStats.lines} line${previewStats.lines === 1 ? '' : 's'} / ${previewStats.percent}%`
                          : 'None'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-950/60 p-3">
                    <p className="mb-1 text-xs text-slate-500">Proof root</p>
                    <div className="flex items-center justify-between gap-3">
                      <code className="truncate font-mono text-xs text-slate-300">
                        {shortHash(unlock.stash.previewProof.root)}
                      </code>
                      <button
                        type="button"
                        onClick={copyProofRoot}
                        className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-200"
                      >
                        {proofRootCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {unlock.blobSha256 && (
                    <div className="rounded-lg bg-slate-950/60 p-3">
                      <p className="mb-1 text-xs text-slate-500">Blob SHA-256</p>
                      <code className="block truncate font-mono text-xs text-slate-300">
                        {shortHash(unlock.blobSha256)}
                      </code>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => unlock.download()}
            className="btn-success mb-4 w-full px-6 py-4 text-lg"
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

          {unlock.stash?.generatedPreview && (
            <div
              className={`mt-5 rounded-xl border p-4 ${
                previewVerification.state === 'invalid'
                  ? 'border-rose-500/40 bg-rose-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/10'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                {previewVerification.state === 'invalid' ? (
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                )}
                <p
                  className={`text-sm font-semibold ${
                    previewVerification.state === 'invalid' ? 'text-rose-300' : 'text-emerald-300'
                  }`}
                >
                  {previewVerification.state === 'invalid'
                    ? 'Stash verification failed'
                    : 'Verified Peek'}
                </p>
              </div>

              {previewVerification.state === 'invalid' ? (
                <p className="rounded-lg bg-rose-950/40 p-3 text-left text-sm text-rose-100/80">
                  Stashu could not verify the published proof for this stash, so payment is blocked.
                  Ask the seller for a fresh stash link.
                </p>
              ) : previewVerification.text !== undefined ? (
                <>
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950/70 p-3 text-left text-sm text-slate-200">
                    {previewVerification.text || 'Empty preview'}
                  </pre>
                  {previewStats && (
                    <p className="mt-3 text-left text-xs text-slate-500">
                      {previewStats.bytes.toLocaleString()} bytes · {previewStats.percent}% ·{' '}
                      {previewStats.lines} line{previewStats.lines === 1 ? '' : 's'}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-2 rounded-lg bg-slate-950/50 p-3 text-left">
                  <FileText className="mt-0.5 w-4 h-4 shrink-0 text-slate-400" />
                  <p className="text-sm text-slate-400">
                    No public peek. Stashu will still check the unlocked file against this
                    commitment after payment.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {!previewProofInvalid && (
          <>
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
                    <button
                      onClick={createInvoice}
                      className="mt-2 text-sm text-amber-400 underline"
                    >
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
                        <span
                          className={timeLeft < 60 ? 'text-rose-400 font-bold' : 'text-slate-400'}
                        >
                          {formatCountdown(timeLeft)}
                        </span>
                      </p>
                    )}

                    {/* Expired state */}
                    {timeLeft !== null && timeLeft <= 0 && (
                      <div className="text-center mb-4">
                        <p className="text-rose-400 text-sm mb-2">Invoice expired</p>
                        <button onClick={refreshInvoice} className="btn-primary px-4 py-2 text-sm">
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
                  className="btn-primary w-full px-6 py-4 text-lg"
                >
                  {unlock.status === 'unlocking' || unlock.status === 'decrypting'
                    ? 'Processing...'
                    : `Unlock for ${unlock.stash?.priceSats} sats`}
                </button>
              </>
            )}
          </>
        )}

        {/* Error Display (shared) */}
        {unlock.error && !previewProofInvalid && (
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
