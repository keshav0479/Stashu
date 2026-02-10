import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Settings,
  Copy,
  Check,
  Eye,
  EyeOff,
  AlertTriangle,
  Trash2,
  Shield,
  Zap,
  Loader2,
  Save,
  Lightbulb,
} from 'lucide-react';
import { hasIdentity, getOrCreateIdentity, getPublicKeyHex, clearIdentity } from '../lib/identity';
import { getSettings, saveSettings } from '../lib/api';
import { useToast } from './Toast';
import { copyToClipboard } from '../lib/clipboard';

export function SettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [nsecRevealed, setNsecRevealed] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Auto-settlement state
  const [lnAddress, setLnAddress] = useState('');
  const [threshold, setThreshold] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsChanged, setSettingsChanged] = useState(false);

  useEffect(() => {
    if (hasIdentity()) {
      const pubkey = getPublicKeyHex();
      getSettings(pubkey)
        .then((s) => {
          setLnAddress(s.lnAddress);
          setThreshold(s.autoWithdrawThreshold);
        })
        .catch(() => {})
        .finally(() => setLoadingSettings(false));
    } else {
      setLoadingSettings(false);
    }
  }, []);

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

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const pubkey = getPublicKeyHex();
      await saveSettings(pubkey, {
        lnAddress,
        autoWithdrawThreshold: threshold,
      });
      toast.showToast('Settings saved!', 'success');
      setSettingsChanged(false);
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const thresholdPresets = [100, 500, 1000, 5000, 10000];
  const isAutoSettleEnabled = lnAddress.trim() !== '' && threshold > 0;

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

        {/* Auto-Settlement */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">Auto-Settlement</h2>
            {isAutoSettleEnabled && (
              <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Active
              </span>
            )}
          </div>
          <p className="text-slate-400 text-sm mb-5">
            Automatically withdraw earnings to your Lightning wallet when your balance reaches the
            threshold. Set it once, earn passively.
          </p>

          {loadingSettings ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
            </div>
          ) : (
            <>
              {/* Lightning Address */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Lightning Address
                </label>
                <input
                  type="text"
                  value={lnAddress}
                  onChange={(e) => {
                    setLnAddress(e.target.value);
                    setSettingsChanged(true);
                  }}
                  placeholder="you@your-wallet.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-amber-400 font-mono text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
                <p className="text-slate-500 text-xs mt-1.5 flex items-start gap-1">
                  <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500/60" />
                  Use an always-online wallet (e.g. Alby, WoS, Coinos) for reliable auto-settlement.
                  Self-custodial mobile wallets may miss payments when offline.
                </p>
              </div>

              {/* Threshold */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Auto-withdraw when balance reaches
                </label>
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="number"
                    value={threshold || ''}
                    onChange={(e) => {
                      setThreshold(Math.max(0, parseInt(e.target.value) || 0));
                      setSettingsChanged(true);
                    }}
                    placeholder="0"
                    min="0"
                    className="w-32 bg-slate-950 border border-slate-700 rounded-xl p-3 text-white text-sm font-mono focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-slate-400 text-sm">sats</span>
                  {threshold === 0 && (
                    <span className="text-slate-500 text-xs">(0 = disabled)</span>
                  )}
                </div>

                {/* Preset buttons */}
                <div className="flex flex-wrap gap-2">
                  {thresholdPresets.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => {
                        setThreshold(preset);
                        setSettingsChanged(true);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        threshold === preset
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      {preset.toLocaleString()} sats
                    </button>
                  ))}
                </div>
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveSettings}
                disabled={saving || !settingsChanged}
                className={`flex items-center gap-2 py-2.5 px-5 rounded-xl font-semibold text-sm transition-all ${
                  saving || !settingsChanged
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-amber-500 hover:bg-amber-600 text-white'
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Settings
                  </>
                )}
              </button>
            </>
          )}
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
