import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useUnlock } from '../lib/useUnlock';

export function UnlockPage() {
  const { id } = useParams<{ id: string }>();
  const unlock = useUnlock(id || '');
  const [token, setToken] = useState('');

  useEffect(() => {
    if (id) {
      unlock.loadStash();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unlock.loadStash]);

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
          <div className="text-5xl mb-4 animate-pulse">🐿️</div>
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
          <div className="text-6xl mb-6">❌</div>
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
          <div className="text-6xl mb-6">🎉</div>
          <h1 className="text-3xl font-bold text-white mb-4">Unlocked!</h1>
          <p className="text-slate-400 mb-8">Your file is ready to download.</p>

          <button
            onClick={() => unlock.download()}
            className="w-full py-4 px-6 bg-green-500 hover:bg-green-600 text-white font-bold text-lg rounded-xl transition-colors mb-4"
          >
            Download File 📥
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
          <div className="text-5xl mb-4 text-center">📦</div>
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

        {/* Token Input */}
        <div className="mb-6">
          <label className="block text-slate-300 mb-2 font-medium">Paste your Cashu token</label>
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

        {/* Error Display */}
        {unlock.error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <p className="text-red-400">{unlock.error}</p>
          </div>
        )}

        {/* Progress Display */}
        {(unlock.status === 'unlocking' || unlock.status === 'decrypting') && (
          <div className="mb-6 bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
            <p className="text-orange-400 flex items-center gap-2">
              <span className="animate-spin">⚡</span>
              {unlock.status === 'unlocking' ? 'Verifying payment...' : 'Decrypting file...'}
            </p>
          </div>
        )}

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
            : `Unlock for ${unlock.stash?.priceSats} sats 🔓`}
        </button>
      </div>
    </div>
  );
}
