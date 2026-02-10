import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Settings, Copy, Check, Eye, EyeOff, AlertTriangle, Trash2, Shield } from 'lucide-react';
import { hasIdentity, getOrCreateIdentity, clearIdentity } from '../lib/identity';
import { useToast } from './Toast';
import { copyToClipboard } from '../lib/clipboard';

export function SettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [nsecRevealed, setNsecRevealed] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  if (!hasIdentity()) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-700 flex items-center justify-center">
            <Settings className="w-8 h-8 text-slate-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">No Identity Found</h1>
          <p className="text-slate-400 mb-8">
            Create a stash first to generate your seller identity.
          </p>
          <Link
            to="/sell"
            className="inline-block py-3 px-6 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
          >
            Create a Stash
          </Link>
        </div>
      </div>
    );
  }

  const identity = getOrCreateIdentity();

  const handleCopy = async (value: string, field: string) => {
    const success = await copyToClipboard(value);
    if (success) {
      setCopiedField(field);
      toast.showToast(`${field} copied!`, 'success');
      setTimeout(() => setCopiedField(null), 2000);
    } else {
      toast.showToast('Failed to copy', 'error');
    }
  };

  const handleClearIdentity = () => {
    clearIdentity();
    toast.showToast('Identity cleared', 'success');
    navigate('/');
  };

  return (
    <div className="min-h-screen py-12 px-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/dashboard"
            className="text-slate-400 hover:text-white text-sm mb-2 inline-block transition-colors"
          >
            ← Back to Dashboard
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center">
              <Settings className="w-5 h-5 text-slate-300" />
            </div>
            <h1 className="text-3xl font-bold text-white">Settings</h1>
          </div>
        </div>

        {/* Public Key */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-semibold text-white">Public Key</h2>
          </div>
          <p className="text-slate-400 text-sm mb-4">
            Your public identity on Nostr. Safe to share — this is how buyers' payments are linked
            to you.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-slate-950 border border-slate-700 rounded-xl p-4 font-mono text-sm text-indigo-300 break-all select-all">
              {identity.npub}
            </div>
            <button
              onClick={() => handleCopy(identity.npub, 'Public key')}
              className="shrink-0 p-3 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors"
              title="Copy public key"
            >
              {copiedField === 'Public key' ? (
                <Check className="w-5 h-5 text-emerald-400" />
              ) : (
                <Copy className="w-5 h-5 text-slate-300" />
              )}
            </button>
          </div>
        </div>

        {/* Recovery Token (nsec) */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">Recovery Token</h2>
          </div>
          <p className="text-slate-400 text-sm mb-4">
            Your secret key. <strong className="text-rose-400">Never share this.</strong> Anyone
            with this token can access your earnings.
          </p>

          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 bg-slate-950 border border-slate-700 rounded-xl p-4 font-mono text-sm text-amber-400 break-all">
              {nsecRevealed
                ? identity.nsec
                : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
            </div>
            <button
              onClick={() => handleCopy(identity.nsec, 'Recovery token')}
              className="shrink-0 p-3 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors"
              title="Copy recovery token"
            >
              {copiedField === 'Recovery token' ? (
                <Check className="w-5 h-5 text-emerald-400" />
              ) : (
                <Copy className="w-5 h-5 text-slate-300" />
              )}
            </button>
          </div>

          <button
            onClick={() => setNsecRevealed(!nsecRevealed)}
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5"
          >
            {nsecRevealed ? (
              <>
                <EyeOff className="w-4 h-4" />
                Hide token
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" />
                Reveal token
              </>
            )}
          </button>
        </div>

        {/* Danger Zone */}
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Trash2 className="w-5 h-5 text-rose-400" />
            <h2 className="text-lg font-semibold text-rose-300">Danger Zone</h2>
          </div>
          <p className="text-slate-400 text-sm mb-4">
            Clear your identity from this device. Make sure you've saved your recovery token first —{' '}
            <strong className="text-rose-400">this cannot be undone</strong>.
          </p>

          {!showClearConfirm ? (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="py-3 px-6 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold rounded-xl hover:bg-rose-500/20 transition-colors"
            >
              Clear Identity
            </button>
          ) : (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4">
              <p className="text-rose-300 text-sm font-medium mb-4">
                Are you sure? This will remove your keys from this device.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleClearIdentity}
                  className="py-2 px-5 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-lg transition-colors"
                >
                  Yes, Clear
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="py-2 px-5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
