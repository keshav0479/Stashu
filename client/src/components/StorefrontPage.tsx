import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { XCircle, Package, Squirrel, FileText } from 'lucide-react';
import { decode } from 'nostr-tools/nip19';
import { getSellerStorefront } from '../lib/api';
import type { StashPublicInfo } from '../../../shared/types';

type LoadingState = 'loading' | 'ready' | 'error' | 'not-enabled' | 'not-found';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Decode npub to hex pubkey. Returns null if invalid. */
function npubToHex(npub: string): string | null {
  try {
    const decoded = decode(npub);
    if (decoded.type !== 'npub') return null;
    return decoded.data as string;
  } catch {
    return null;
  }
}

export function StorefrontPage() {
  const { npub } = useParams<{ npub: string }>();
  const [state, setState] = useState<LoadingState>('loading');
  const [stashes, setStashes] = useState<StashPublicInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hexPubkey = npub ? npubToHex(npub) : null;

  useEffect(() => {
    if (!hexPubkey) {
      // Defer state update to avoid synchronous setState in effect body
      const id = requestAnimationFrame(() => setState('not-found'));
      return () => cancelAnimationFrame(id);
    }

    let cancelled = false;

    getSellerStorefront(hexPubkey)
      .then((data) => {
        if (!cancelled) {
          setStashes(data);
          setState('ready');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load storefront';
          if (msg === 'Storefront is not enabled') {
            setState('not-enabled');
          } else if (msg === 'Seller not found') {
            setState('not-found');
          } else {
            setError(msg);
            setState('error');
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hexPubkey]);

  // Loading skeleton
  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <div className="skeleton h-4 w-24 mb-3" />
            <div className="skeleton h-8 w-56 mb-2" />
            <div className="skeleton h-4 w-40" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6"
                style={{ opacity: 1 - i * 0.2 }}
              >
                <div className="skeleton h-32 w-full rounded-lg mb-4" />
                <div className="skeleton h-5 w-3/4 mb-2" />
                <div className="skeleton h-4 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Seller not found (invalid npub or never used Stashu)
  if (state === 'not-found') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-700 flex items-center justify-center">
            <Squirrel className="w-8 h-8 text-slate-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">Seller Not Found</h1>
          <p className="text-slate-400 mb-8">
            This seller doesn't exist on Stashu or the link is invalid.
          </p>
          <Link to="/" className="btn-primary px-6 py-3">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // Storefront not enabled
  if (state === 'not-enabled') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-700 flex items-center justify-center">
            <Squirrel className="w-8 h-8 text-slate-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">Storefront Not Available</h1>
          <p className="text-slate-400 mb-8">This seller hasn't enabled their public storefront.</p>
          <Link to="/" className="btn-primary px-6 py-3">
            Go Home
          </Link>
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
          <h1 className="text-2xl font-bold text-white mb-4">Failed to Load Storefront</h1>
          <p className="text-slate-400 mb-8">{error}</p>
          <button onClick={() => window.location.reload()} className="btn-primary px-6 py-3">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Short npub for display
  const shortNpub = npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : '';

  return (
    <div className="min-h-screen bg-slate-900 py-12 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/"
            className="text-slate-400 hover:text-white text-sm mb-2 inline-block transition-colors"
          >
            ← Back to Home
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <Squirrel className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-3xl font-bold text-white">Storefront</h1>
          </div>
          <p className="text-slate-500 text-sm font-mono">{shortNpub}</p>
        </div>

        {/* Empty state */}
        {stashes.length === 0 ? (
          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-700 flex items-center justify-center">
              <Package className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-slate-400">This seller has no stashes yet.</p>
          </div>
        ) : (
          <>
            <p className="text-slate-400 text-sm mb-4">
              {stashes.length} stash{stashes.length !== 1 ? 'es' : ''} available
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {stashes.map((stash) => (
                <Link
                  key={stash.id}
                  to={`/s/${stash.id}`}
                  className="group bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden hover:border-orange-500/50 transition-colors"
                >
                  {/* Preview image or placeholder */}
                  {stash.previewUrl ? (
                    <div className="aspect-video bg-slate-800 overflow-hidden">
                      <img
                        src={stash.previewUrl}
                        alt={stash.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  ) : (
                    <div className="aspect-video bg-slate-800/80 flex items-center justify-center">
                      <FileText className="w-10 h-10 text-slate-600" />
                    </div>
                  )}

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="text-white font-semibold mb-1 truncate group-hover:text-orange-400 transition-colors">
                      {stash.title}
                    </h3>
                    {stash.description && (
                      <p className="text-slate-400 text-sm mb-2 line-clamp-2">
                        {stash.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-orange-400 font-bold">
                        {stash.priceSats.toLocaleString()} sats
                      </span>
                      <span className="text-slate-500 text-xs">
                        {formatFileSize(stash.fileSize)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
