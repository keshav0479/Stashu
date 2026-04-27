import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  XCircle,
  Copy,
  Package,
  Squirrel,
  Settings,
  Zap,
  History,
  Link as LinkIcon,
  Store,
} from 'lucide-react';
import { getDashboard, getSettlements, toggleStashVisibility } from '../lib/api';
import { getPublicKeyHex, getOrCreateIdentity, hasIdentity } from '../lib/identity';
import { useToast } from './useToast';
import { copyToClipboard } from '../lib/clipboard';
import { WithdrawModal } from './WithdrawModal';
import { SettlementHistoryModal } from './SettlementHistoryModal';
import type {
  DashboardResponse,
  SellerStashStats,
  SettlementLogEntry,
} from '../../../shared/types';

type LoadingState = 'loading' | 'ready' | 'error' | 'no-identity';

export function DashboardPage() {
  const [state, setState] = useState<LoadingState>(() =>
    hasIdentity() ? 'loading' : 'no-identity'
  );
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [settlements, setSettlements] = useState<SettlementLogEntry[]>([]);
  const toast = useToast();

  useEffect(() => {
    if (!hasIdentity()) return;

    let cancelled = false;
    const loadDashboard = async () => {
      try {
        const pubkey = getPublicKeyHex();
        const dashboardData = await getDashboard(pubkey);
        if (!cancelled) {
          setData(dashboardData);
          setState('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard');
          setState('error');
        }
      }
    };

    async function loadSettlements() {
      try {
        const pubkey = getPublicKeyHex();
        const result = await getSettlements(pubkey);
        setSettlements(result);
      } catch {
        // Settlement history is optional, don't block on errors
      }
    }

    loadDashboard();
    loadSettlements();

    // Poll for updates every 30 seconds
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadDashboard();
        loadSettlements();
      }
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const refreshDashboard = async () => {
    try {
      const pubkey = getPublicKeyHex();
      const dashboardData = await getDashboard(pubkey);
      setData(dashboardData);
    } catch {
      // silently fail on refresh
    }
  };

  const copyAllTokens = async () => {
    if (!data?.earnings.tokens.length) return;

    // Join all tokens with newlines for easy pasting
    const allTokens = data.earnings.tokens.join('\n\n');
    const success = await copyToClipboard(allTokens);

    if (success) {
      toast.showToast(`Copied ${data.earnings.tokens.length} token(s)!`, 'success');
    } else {
      toast.showToast('Failed to copy tokens', 'error');
    }
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // No identity state
  if (state === 'no-identity') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-orange-500/20 flex items-center justify-center">
            <Squirrel className="w-8 h-8 text-orange-400" />
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

  // Loading state — skeleton UI
  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 py-12 px-6">
        <div className="max-w-4xl mx-auto">
          {/* Header skeleton */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="skeleton h-4 w-24 mb-3" />
              <div className="skeleton h-8 w-48" />
            </div>
            <div className="flex items-center gap-3">
              <div className="skeleton h-10 w-10 rounded-xl" />
              <div className="skeleton h-10 w-28 rounded-xl" />
            </div>
          </div>

          {/* Earnings card skeleton */}
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-8 mb-8">
            <div className="flex items-center gap-12">
              <div>
                <div className="skeleton h-4 w-24 mb-3" />
                <div className="skeleton h-10 w-32" />
              </div>
              <div className="hidden sm:block w-px h-12 bg-white/5" />
              <div>
                <div className="skeleton h-4 w-28 mb-3" />
                <div className="skeleton h-8 w-20" />
              </div>
            </div>
          </div>

          {/* Stash list skeleton */}
          <div className="skeleton h-6 w-28 mb-4" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6"
                style={{ opacity: 1 - i * 0.2 }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="skeleton h-5 w-40 mb-2" />
                    <div className="skeleton h-3 w-56" />
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <div className="skeleton h-7 w-8 mx-auto mb-1" />
                      <div className="skeleton h-3 w-12" />
                    </div>
                    <div className="text-center">
                      <div className="skeleton h-7 w-8 mx-auto mb-1" />
                      <div className="skeleton h-3 w-16" />
                    </div>
                    <div className="skeleton h-9 w-9 rounded-lg" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (state === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-rose-500/20 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-rose-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">Error Loading Dashboard</h1>
          <p className="text-slate-400 mb-8">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="py-3 px-6 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const hasEarnings = data && data.earnings.totalSats > 0;
  const hasStashes = data && data.stashes.length > 0;

  // Calculate Gross Revenue (sum of all stash earnings)
  const totalRevenue = data?.stashes.reduce((sum, s) => sum + s.totalEarned, 0) || 0;
  // Current Balance (unclaimed)
  const availableBalance = data?.earnings.totalSats || 0;

  return (
    <div className="min-h-screen bg-slate-900 py-12 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4 sm:gap-0">
          <div>
            <Link
              to="/"
              className="text-slate-400 hover:text-white text-sm mb-2 inline-block transition-colors"
            >
              ← Back to Home
            </Link>
            <h1 className="text-3xl font-bold text-white">Seller Dashboard</h1>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            {data?.storefrontEnabled && (
              <button
                onClick={async () => {
                  const { npub } = getOrCreateIdentity();
                  const url = `${window.location.origin}/p/${npub}`;
                  const success = await copyToClipboard(url);
                  if (success) {
                    toast.showToast('Storefront link copied!', 'success');
                  } else {
                    toast.showToast('Failed to copy link', 'error');
                  }
                }}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
                title="Copy Storefront Link"
              >
                <LinkIcon className="w-5 h-5 text-slate-400" />
              </button>
            )}
            <Link
              to="/settings"
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
              title="Settings"
            >
              <Settings className="w-5 h-5 text-slate-400" />
            </Link>
            <Link
              to="/sell"
              className="flex-1 sm:flex-initial text-center py-2 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
            >
              + New Stash
            </Link>
          </div>
        </div>

        {/* Earnings Card */}
        <div className="relative bg-linear-to-br from-orange-500/20 to-amber-500/10 border border-orange-500/30 rounded-2xl p-8 mb-8">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-8 sm:gap-0">
              <div className="flex flex-col sm:flex-row items-center gap-8 sm:gap-12 w-full sm:w-auto">
                <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-orange-300 text-sm font-medium">Total Revenue</p>
                    <button
                      onClick={() => setShowHistory(true)}
                      className="p-1 text-orange-300/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      title="View Settlement History"
                    >
                      <History className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-white">
                      {totalRevenue.toLocaleString()}
                    </span>
                    <span className="text-xl text-orange-400">sats</span>
                  </div>
                </div>

                <div className="hidden sm:block w-px h-12 bg-white/10" />
                <div className="block sm:hidden w-16 h-px bg-white/10" />

                <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
                  <p className="text-slate-400 text-sm font-medium mb-1">Available Balance</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-200">
                      {availableBalance.toLocaleString()}
                    </span>
                    <span className="text-sm text-slate-500">sats</span>
                  </div>
                  {hasEarnings && (
                    <p className="text-slate-500 text-xs mt-1">
                      {data!.earnings.tokens.length} unclaimed token(s)
                    </p>
                  )}
                </div>
              </div>

              {totalRevenue > 0 && (
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => setShowWithdraw(true)}
                    disabled={availableBalance === 0}
                    className="w-full sm:w-auto py-3 px-6 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <Zap
                      className={`w-4 h-4 ${availableBalance === 0 ? 'text-slate-500' : 'text-white'}`}
                    />
                    Withdraw
                  </button>
                  {data!.earnings.tokens.length > 0 && (
                    <button
                      onClick={copyAllTokens}
                      className="w-full sm:w-auto py-3 px-6 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copy Tokens
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stashes List */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Your Stashes</h2>

          {!hasStashes ? (
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-700 flex items-center justify-center">
                <Package className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-slate-400 mb-4">No stashes yet. Create your first one!</p>
              <Link
                to="/sell"
                className="inline-block py-2 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
              >
                Create Stash
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {data!.stashes.map((stash: SellerStashStats) => (
                <div
                  key={stash.id}
                  className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex-1 w-full sm:w-auto">
                      <h3 className="text-lg font-semibold text-white mb-1 truncate">
                        {stash.title}
                      </h3>
                      <p className="text-slate-500 text-sm">
                        Created {formatDate(stash.createdAt)} • {stash.priceSats} sats
                      </p>
                    </div>

                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end border-t border-slate-700/50 pt-4 sm:pt-0 sm:border-0">
                      <div className="flex gap-6">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-white">{stash.unlockCount}</p>
                          <p className="text-slate-500 text-xs">Unlocks</p>
                        </div>

                        <div className="text-center">
                          <p className="text-2xl font-bold text-orange-400">
                            {stash.totalEarned.toLocaleString()}
                          </p>
                          <p className="text-slate-500 text-xs">Sats earned</p>
                        </div>
                      </div>

                      <button
                        onClick={async () => {
                          const newValue = !stash.showInStorefront;
                          try {
                            await toggleStashVisibility(stash.id, newValue);
                            stash.showInStorefront = newValue;
                            setData({ ...data! });
                            toast.showToast(
                              newValue ? 'Visible in storefront' : 'Hidden from storefront',
                              'success'
                            );
                          } catch {
                            toast.showToast('Failed to update visibility', 'error');
                          }
                        }}
                        disabled={!data!.storefrontEnabled}
                        className={`p-2 rounded-lg transition-colors ${
                          !data!.storefrontEnabled
                            ? 'bg-slate-800 cursor-not-allowed opacity-50'
                            : stash.showInStorefront
                              ? 'bg-violet-500/20 hover:bg-violet-500/30'
                              : 'bg-slate-700 hover:bg-slate-600'
                        }`}
                        title={
                          !data!.storefrontEnabled
                            ? 'Enable your public storefront in Settings first'
                            : stash.showInStorefront
                              ? 'Visible in storefront — click to hide'
                              : 'Hidden from storefront — click to show'
                        }
                      >
                        <Store
                          className={`w-5 h-5 ${
                            !data!.storefrontEnabled
                              ? 'text-slate-600'
                              : stash.showInStorefront
                                ? 'text-violet-400'
                                : 'text-slate-500'
                          }`}
                        />
                      </button>

                      <button
                        onClick={async () => {
                          const url = `${window.location.origin}/s/${stash.id}`;
                          const success = await copyToClipboard(url);
                          if (success) {
                            toast.showToast('Link copied!', 'success');
                          } else {
                            toast.showToast('Failed to copy link', 'error');
                          }
                        }}
                        className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                        title="Copy Link"
                      >
                        <LinkIcon className="w-5 h-5 text-slate-300" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Settlement History Modal */}
      {showHistory && (
        <SettlementHistoryModal settlements={settlements} onClose={() => setShowHistory(false)} />
      )}

      {/* Withdraw Modal */}
      {showWithdraw && data && (
        <WithdrawModal
          totalSats={data.earnings.totalSats}
          onClose={() => setShowWithdraw(false)}
          onSuccess={refreshDashboard}
        />
      )}
    </div>
  );
}
