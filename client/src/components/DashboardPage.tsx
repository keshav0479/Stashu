import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboard } from '../lib/api';
import { getPublicKeyHex, hasIdentity } from '../lib/identity';
import { useToast } from './Toast';
import type { DashboardResponse, SellerStashStats } from '../../../shared/types';

type LoadingState = 'loading' | 'ready' | 'error' | 'no-identity';

export function DashboardPage() {
  const [state, setState] = useState<LoadingState>(() =>
    hasIdentity() ? 'loading' : 'no-identity'
  );
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
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

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  const copyAllTokens = async () => {
    if (!data?.earnings.tokens.length) return;

    try {
      // Join all tokens with newlines for easy pasting
      const allTokens = data.earnings.tokens.join('\n\n');
      await navigator.clipboard.writeText(allTokens);
      toast.showToast(`Copied ${data.earnings.tokens.length} token(s)!`, 'success');
    } catch {
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
          <div className="text-6xl mb-6">🐿️</div>
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

  // Loading state
  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">📊</div>
          <p className="text-slate-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (state === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-6">❌</div>
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

  return (
    <div className="min-h-screen bg-slate-900 py-12 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link
              to="/"
              className="text-slate-400 hover:text-white text-sm mb-2 inline-block transition-colors"
            >
              ← Back to Home
            </Link>
            <h1 className="text-3xl font-bold text-white">Seller Dashboard</h1>
          </div>
          <Link
            to="/sell"
            className="py-2 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
          >
            + New Stash
          </Link>
        </div>

        {/* Earnings Card */}
        <div className="bg-linear-to-br from-orange-500/20 to-amber-500/10 border border-orange-500/30 rounded-2xl p-8 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-300 text-sm font-medium mb-1">Total Earnings</p>
              <p className="text-4xl font-bold text-white">
                {data?.earnings.totalSats.toLocaleString() || 0}{' '}
                <span className="text-xl text-orange-400">sats</span>
              </p>
              {hasEarnings && (
                <p className="text-slate-400 text-sm mt-2">
                  {data!.earnings.tokens.length} unclaimed token(s)
                </p>
              )}
            </div>

            {hasEarnings && (
              <button
                onClick={copyAllTokens}
                className="py-3 px-6 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors flex items-center gap-2"
              >
                <span>📋</span>
                Copy All Tokens
              </button>
            )}
          </div>

          {/* Fee Tip */}
          {hasEarnings && (
            <div className="mt-6 bg-slate-900/50 rounded-xl p-4 border border-slate-700">
              <p className="text-slate-300 text-sm">
                💡 <strong>Tip:</strong> To convert to Lightning, paste tokens in{' '}
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
                , then melt to your Lightning wallet. Fee is usually 2-10 sats.
              </p>
            </div>
          )}
        </div>

        {/* Stashes List */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Your Stashes</h2>

          {!hasStashes ? (
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 text-center">
              <div className="text-5xl mb-4">📦</div>
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
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-white mb-1">{stash.title}</h3>
                      <p className="text-slate-500 text-sm">
                        Created {formatDate(stash.createdAt)} • {stash.priceSats} sats per unlock
                      </p>
                    </div>

                    <div className="flex items-center gap-6">
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

                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/s/${stash.id}`;
                          navigator.clipboard.writeText(url);
                          toast.showToast('Link copied!', 'success');
                        }}
                        className="py-2 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm"
                      >
                        Copy Link
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
