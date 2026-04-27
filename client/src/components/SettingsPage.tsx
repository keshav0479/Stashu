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
  Server,
  Store,
} from 'lucide-react';
import { hasIdentity, getOrCreateIdentity, getPublicKeyHex, clearIdentity } from '../lib/identity';
import { getSettings, saveSettings } from '../lib/api';
import {
  getBlossomServer,
  setBlossomServer,
  validateBlossomUrl,
  PRESET_BLOSSOM_SERVERS,
  getMirroringEnabled,
  setMirroringEnabled,
} from '../lib/blossom';
import { useToast } from './useToast';
import { copyToClipboard } from '../lib/clipboard';

type SettingsTab = 'payments' | 'account' | 'advanced';

export function SettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('payments');
  const [nsecRevealed, setNsecRevealed] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Auto-settlement state
  const [lnAddress, setLnAddress] = useState('');
  const [threshold, setThreshold] = useState(0);
  const [savedLnAddress, setSavedLnAddress] = useState('');
  const [savedThreshold, setSavedThreshold] = useState(0);
  const [storefrontEnabled, setStorefrontEnabled] = useState(false);
  const [savingStorefront, setSavingStorefront] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsChanged, setSettingsChanged] = useState(false);

  // Blossom server state
  const [blossomServer, setBlossomServerState] = useState(getBlossomServer());
  const [customBlossomUrl, setCustomBlossomUrl] = useState('');
  const [blossomUrlError, setBlossomUrlError] = useState('');
  const [mirroringEnabled, setMirroringEnabledState] = useState(getMirroringEnabled());

  const isCustomServer = !PRESET_BLOSSOM_SERVERS.some((s) => s.url === blossomServer);

  useEffect(() => {
    if (isCustomServer) {
      setCustomBlossomUrl(blossomServer);
    }
  }, [blossomServer, isCustomServer]);

  useEffect(() => {
    if (hasIdentity()) {
      const pubkey = getPublicKeyHex();
      getSettings(pubkey)
        .then((s) => {
          setLnAddress(s.lnAddress);
          setThreshold(s.autoWithdrawThreshold);
          setStorefrontEnabled(s.storefrontEnabled);
          setSavedLnAddress(s.lnAddress);
          setSavedThreshold(s.autoWithdrawThreshold);
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
        storefrontEnabled,
      });
      toast.showToast('Settings saved!', 'success');
      setSavedLnAddress(lnAddress);
      setSavedThreshold(threshold);
      setSettingsChanged(false);
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectBlossomPreset = (url: string) => {
    setBlossomServer(url);
    setBlossomServerState(url);
    setCustomBlossomUrl('');
    setBlossomUrlError('');
    toast.showToast('Blossom server updated', 'success');
  };

  const handleCustomBlossomSubmit = () => {
    if (!customBlossomUrl.trim()) return;
    let url = customBlossomUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const result = validateBlossomUrl(url);
    if (!result.valid) {
      setBlossomUrlError(result.error || 'Invalid URL');
      return;
    }
    const normalized = url.replace(/\/+$/, '');
    // If it matches a preset, select that preset instead
    const matchingPreset = PRESET_BLOSSOM_SERVERS.find((s) => s.url === normalized);
    if (matchingPreset) {
      handleSelectBlossomPreset(matchingPreset.url);
      return;
    }
    setBlossomServer(normalized);
    setBlossomServerState(normalized);
    setBlossomUrlError('');
    toast.showToast('Blossom server updated', 'success');
  };

  const handleToggleStorefront = async () => {
    const newValue = !storefrontEnabled;
    setSavingStorefront(true);
    setStorefrontEnabled(newValue);
    try {
      const pubkey = getPublicKeyHex();
      await saveSettings(pubkey, {
        lnAddress: savedLnAddress,
        autoWithdrawThreshold: savedThreshold,
        storefrontEnabled: newValue,
      });
      toast.showToast(newValue ? 'Storefront enabled' : 'Storefront disabled', 'success');
    } catch (err) {
      setStorefrontEnabled(!newValue); // revert on failure
      toast.showToast(err instanceof Error ? err.message : 'Failed to update', 'error');
    } finally {
      setSavingStorefront(false);
    }
  };

  const thresholdPresets = [100, 500, 1000, 5000, 10000];
  const isAutoSettleActive = savedLnAddress.trim() !== '' && savedThreshold > 0;

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'payments', label: 'Payments' },
    { id: 'account', label: 'Account' },
    { id: 'advanced', label: 'Advanced' },
  ];

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

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-800/50 rounded-xl p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
                activeTab === tab.id
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-[620px]">
          {/* Payments Tab */}
          {activeTab === 'payments' && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-semibold text-white">Auto-Settlement</h2>
                {isAutoSettleActive ? (
                  <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Active
                  </span>
                ) : (
                  <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400 border border-slate-700/50">
                    Disabled
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-sm mb-5">
                Automatically withdraw earnings to your Lightning wallet when your balance reaches
                the threshold. Set it once, earn passively.
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
                      Use an always-online wallet (e.g. Alby, WoS, Coinos) for reliable
                      auto-settlement. Self-custodial mobile wallets may miss payments when offline.
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
                    {threshold > 0 && (
                      <p className="text-slate-500 text-xs mt-2">
                        When balance reaches {threshold.toLocaleString()} sats, all earnings are
                        withdrawn minus the network routing fee. If withdrawal fails (e.g. wallet
                        offline), tokens stay safe and retry on the next payment.
                      </p>
                    )}
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
                  {isAutoSettleActive && (
                    <p className="text-slate-500 text-xs mt-2">
                      To disable, clear the Lightning address and save.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Account Tab */}
          {activeTab === 'account' && (
            <>
              {/* Public Storefront */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 mb-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                      <Store className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Public Storefront</h2>
                      <p className="text-slate-400 text-sm">
                        Let anyone browse all your stashes from one link.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleStorefront}
                    disabled={savingStorefront || loadingSettings}
                    className={`relative w-12 h-7 rounded-full transition-colors ${
                      savingStorefront ? 'opacity-50 cursor-not-allowed' : ''
                    } ${storefrontEnabled ? 'bg-violet-500' : 'bg-slate-600'}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                        storefrontEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <div className="mt-4 pt-4 border-t border-slate-700/50">
                  {storefrontEnabled && (
                    <p className="text-slate-500 text-sm mb-3">
                      Your storefront:{' '}
                      <button
                        onClick={async () => {
                          const url = `${window.location.origin}/p/${identity.npub}`;
                          const success = await copyToClipboard(url);
                          if (success) {
                            toast.showToast('Storefront link copied!', 'success');
                          }
                        }}
                        className="text-violet-400 hover:text-violet-300 underline transition-colors"
                      >
                        {window.location.origin}/p/{identity.npub.slice(0, 12)}…
                      </button>
                    </p>
                  )}
                  <div className="p-3 bg-slate-700/30 border border-slate-700/50 rounded-lg">
                    <p className="text-slate-400 text-xs">
                      Your storefront URL contains your Nostr public key. Sharing it publicly will
                      link your Nostr identity to your Stashu presence.
                    </p>
                  </div>
                </div>
              </div>

              {/* Public Key */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-lg font-semibold text-white">Public Key</h2>
                </div>
                <p className="text-slate-400 text-sm mb-4">
                  Your public identity on Nostr. Safe to share — this is how buyers' payments are
                  linked to you.
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
                  Your secret key. <strong className="text-rose-400">Never share this.</strong>{' '}
                  Anyone with this token can access your earnings.
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
                  Clear your identity from this device. Make sure you've saved your recovery token
                  first — <strong className="text-rose-400">this cannot be undone</strong>.
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
            </>
          )}

          {/* Advanced Tab */}
          {activeTab === 'advanced' && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-5 h-5 text-cyan-400" />
                <h2 className="text-lg font-semibold text-white">Blossom Server</h2>
              </div>
              <p className="text-slate-400 text-sm mb-5">
                Choose where your encrypted files are stored. Use the toggle below to control backup
                mirroring.
              </p>

              {/* Preset server buttons */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Select a server
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_BLOSSOM_SERVERS.map((server) => (
                    <button
                      key={server.url}
                      onClick={() => handleSelectBlossomPreset(server.url)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        blossomServer === server.url
                          ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      {server.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom URL input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Or use a custom server
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={customBlossomUrl}
                    onChange={(e) => {
                      setCustomBlossomUrl(e.target.value);
                      setBlossomUrlError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCustomBlossomSubmit();
                    }}
                    onBlur={() => {
                      if (customBlossomUrl.trim()) handleCustomBlossomSubmit();
                    }}
                    placeholder="your-blossom-server.com"
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl p-3 text-cyan-400 font-mono text-sm placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                {blossomUrlError && (
                  <p className="text-rose-400 text-xs mt-1.5">{blossomUrlError}</p>
                )}
                <p className="text-slate-500 text-xs mt-1.5">
                  Most public Blossom servers don't support encrypted file uploads. Only add a
                  server you've tested.
                </p>
              </div>

              {/* Current server indicator */}
              <div className="bg-slate-950/50 border border-slate-700/50 rounded-xl p-3 mb-4">
                <p className="text-slate-500 text-xs">
                  Current: <span className="text-cyan-400 font-mono">{blossomServer}</span>
                </p>
              </div>

              {/* Mirroring toggle — only show when there are backup servers to mirror to */}
              {PRESET_BLOSSOM_SERVERS.filter((s) => s.url !== blossomServer).length > 0 && (
                <div className="flex items-center justify-between py-3 border-t border-slate-700/50 mt-2 mb-3">
                  <div>
                    <p className="text-sm font-medium text-slate-300">Mirror to backup servers</p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      Copies your file to other Blossom servers so buyers can download even if your
                      primary server is down.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !mirroringEnabled;
                      setMirroringEnabled(next);
                      setMirroringEnabledState(next);
                      toast.showToast(next ? 'Mirroring enabled' : 'Mirroring disabled', 'success');
                    }}
                    className={`relative shrink-0 ml-4 w-11 h-6 rounded-full transition-colors ${
                      mirroringEnabled ? 'bg-cyan-500' : 'bg-slate-600'
                    }`}
                    role="switch"
                    aria-checked={mirroringEnabled}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        mirroringEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              )}

              {/* Hints */}
              <div className="space-y-1.5">
                <p className="text-slate-500 text-xs flex items-start gap-1">
                  <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0 text-cyan-500/60" />
                  Applies to new stashes only. Existing stashes stay on their original server.
                </p>
                <p className="text-slate-500 text-xs flex items-start gap-1">
                  <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0 text-cyan-500/60" />
                  Your server must be publicly accessible for buyers to download files.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
