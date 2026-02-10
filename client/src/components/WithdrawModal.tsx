import { useState } from 'react';
import { Zap, X, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { getWithdrawQuote, executeWithdraw } from '../lib/api';
import { getPublicKeyHex } from '../lib/identity';
import { useToast } from './Toast';

interface WithdrawModalProps {
  totalSats: number;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'input' | 'confirm' | 'processing' | 'done';

export function WithdrawModal({ totalSats, onClose, onSuccess }: WithdrawModalProps) {
  const [step, setStep] = useState<Step>('input');
  const [invoice, setInvoice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{
    totalSats: number;
    feeSats: number;
    netSats: number;
  } | null>(null);
  const [result, setResult] = useState<{ feeSats: number; preimage: string } | null>(null);
  const toast = useToast();

  const handleGetQuote = async () => {
    if (!invoice.trim()) {
      setError('Please paste a Lightning invoice');
      return;
    }

    if (!invoice.trim().toLowerCase().startsWith('lnbc')) {
      setError('Invalid invoice. Must be a BOLT11 Lightning invoice (starts with lnbc)');
      return;
    }

    setError(null);

    try {
      const pubkey = getPublicKeyHex();
      const quoteData = await getWithdrawQuote(pubkey, invoice.trim());
      setQuote(quoteData);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get fee estimate');
    }
  };

  const handleWithdraw = async () => {
    setStep('processing');
    setError(null);

    try {
      const pubkey = getPublicKeyHex();
      const withdrawResult = await executeWithdraw(pubkey, invoice.trim());
      setResult({
        feeSats: withdrawResult.feeSats,
        preimage: withdrawResult.preimage,
      });
      setStep('done');
      toast.showToast('⚡ Withdrawal successful!', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdrawal failed');
      setStep('confirm');
    }
  };

  const handleClose = () => {
    if (step === 'done') {
      onSuccess();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Withdraw to Lightning</h2>
          </div>
          {step !== 'processing' && (
            <button
              onClick={handleClose}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          )}
        </div>

        {/* Step 1: Invoice Input */}
        {step === 'input' && (
          <>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-4">
              <p className="text-slate-300 text-sm">
                Available:{' '}
                <strong className="text-orange-400">{totalSats.toLocaleString()} sats</strong>
              </p>
            </div>

            <label className="block text-sm font-medium text-slate-300 mb-2">
              BOLT11 Lightning Invoice
            </label>
            <textarea
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              placeholder="lnbc..."
              rows={4}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-amber-400 font-mono text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500 resize-none mb-2"
            />
            <p className="text-slate-500 text-xs mb-4">
              Create an invoice in your Lightning wallet for the amount you want to withdraw.
            </p>

            {error && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 mb-4">
                <p className="text-rose-400 text-sm">{error}</p>
              </div>
            )}

            <button
              onClick={handleGetQuote}
              disabled={!invoice.trim()}
              className={`w-full py-3 rounded-xl font-semibold transition-all ${
                !invoice.trim()
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-amber-500 hover:bg-amber-600 text-white'
              }`}
            >
              Get Fee Estimate
            </button>
          </>
        )}

        {/* Step 2: Confirm */}
        {step === 'confirm' && quote && (
          <>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between items-center py-3 border-b border-slate-800">
                <span className="text-slate-400">Available balance</span>
                <span className="text-white font-semibold">
                  {quote.totalSats.toLocaleString()} sats
                </span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-slate-800">
                <span className="text-slate-400">Network fee (estimate)</span>
                <span className="text-rose-400 font-semibold">−{quote.feeSats} sats</span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-slate-300 font-medium">You receive</span>
                <span className="text-amber-400 font-bold text-lg">
                  {quote.netSats.toLocaleString()} sats
                </span>
              </div>
            </div>

            {error && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 mb-4">
                <p className="text-rose-400 text-sm">{error}</p>
              </div>
            )}

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-6">
              <p className="text-amber-300 text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                This will withdraw <strong>all</strong> your unclaimed earnings. This cannot be
                undone.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setStep('input');
                  setError(null);
                }}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleWithdraw}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                Withdraw
              </button>
            </div>
          </>
        )}

        {/* Step 3: Processing */}
        {step === 'processing' && (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 text-amber-400 animate-spin mx-auto mb-4" />
            <p className="text-white font-semibold mb-2">Processing withdrawal...</p>
            <p className="text-slate-400 text-sm">
              Aggregating tokens and paying Lightning invoice. This may take a moment.
            </p>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && result && (
          <div className="text-center py-4">
            <div className="w-16 h-16 mx-auto mb-4 bg-emerald-500/20 rounded-2xl flex items-center justify-center">
              <Check className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">Withdrawn! ⚡</h3>
            <p className="text-slate-400 mb-6">
              Your sats are on their way to your Lightning wallet.
            </p>

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-6 text-left">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-400">Fee paid</span>
                <span className="text-slate-300">{result.feeSats} sats</span>
              </div>
              {result.preimage && (
                <div className="text-sm">
                  <span className="text-slate-400">Preimage</span>
                  <p className="text-slate-500 font-mono text-xs break-all mt-1">
                    {result.preimage}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={handleClose}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
