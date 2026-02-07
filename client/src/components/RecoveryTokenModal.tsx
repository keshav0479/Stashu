import { useState } from 'react';
import { getRecoveryToken, acknowledgeRecovery } from '../lib/identity';
import { useToast } from './Toast';

interface RecoveryTokenModalProps {
  onComplete: () => void;
}

export function RecoveryTokenModal({ onComplete }: RecoveryTokenModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const recoveryToken = getRecoveryToken();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryToken);
      setCopied(true);
      toast.showToast('Recovery token copied!', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.showToast('Failed to copy', 'error');
    }
  };

  const handleContinue = () => {
    if (acknowledged) {
      acknowledgeRecovery();
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-amber-500/20 rounded-2xl flex items-center justify-center">
            <svg
              className="w-8 h-8 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Your Recovery Token</h2>
          <p className="text-slate-400 text-sm">
            This is the only way to recover your funds. Save it somewhere safe!
          </p>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-4">
          <div className="font-mono text-sm text-amber-400 break-all select-all leading-relaxed">
            {recoveryToken}
          </div>
        </div>

        <button
          onClick={handleCopy}
          className={`w-full py-3 rounded-xl font-semibold transition-all mb-6 flex items-center justify-center gap-2 ${
            copied ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          {copied ? (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy to Clipboard
            </>
          )}
        </button>

        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 mb-6">
          <div className="flex gap-3">
            <svg
              className="w-5 h-5 text-rose-400 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div className="text-sm text-rose-300">
              <p className="font-semibold mb-1">If you lose this token, you lose your funds.</p>
              <p className="text-rose-400/80">There is no recovery. Save it before continuing.</p>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-3 mb-6 cursor-pointer group">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="w-5 h-5 mt-0.5 rounded border-slate-600 bg-slate-800 text-amber-500 
                       focus:ring-amber-500 focus:ring-offset-0 cursor-pointer"
          />
          <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
            I have saved my recovery token in a safe place
          </span>
        </label>

        <button
          onClick={handleContinue}
          disabled={!acknowledged}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            acknowledged
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 shadow-lg shadow-amber-500/25'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          Continue to Stashu
        </button>
      </div>
    </div>
  );
}
