import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Key, Info } from 'lucide-react';
import { importFromRecoveryToken } from '../lib/identity';
import { useToast } from './Toast';

export function RestorePage() {
  const [nsec, setNsec] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const handleRestore = () => {
    if (!nsec.trim()) {
      toast.showToast('Please enter your recovery token', 'error');
      return;
    }

    if (!nsec.startsWith('nsec1')) {
      toast.showToast('Invalid format. Token should start with nsec1', 'error');
      return;
    }

    setLoading(true);
    const result = importFromRecoveryToken(nsec.trim());

    if (result.success) {
      toast.showToast('Account restored successfully!', 'success');
      setTimeout(() => navigate('/dashboard'), 500);
    } else {
      toast.showToast(result.error || 'Failed to restore account', 'error');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-6 bg-amber-500/20 rounded-2xl flex items-center justify-center">
            <Key className="w-10 h-10 text-amber-500" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Restore Account</h1>
          <p className="text-slate-400">
            Enter your recovery token (nsec) to restore your seller identity and access your
            earnings.
          </p>
        </div>

        <div className="glass-card p-6">
          <label className="block text-sm font-medium text-slate-300 mb-2">Recovery Token</label>
          <textarea
            value={nsec}
            onChange={(e) => setNsec(e.target.value)}
            placeholder="nsec1..."
            rows={3}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-amber-400 font-mono text-sm placeholder-slate-600 focus:outline-none focus:border-amber-500 resize-none"
          />

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mt-4 mb-6">
            <p className="text-slate-400 text-sm flex items-start gap-2">
              <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              Your recovery token was shown when you first created a stash. If you've lost it, your
              funds cannot be recovered.
            </p>
          </div>

          <button
            onClick={handleRestore}
            disabled={loading || !nsec.trim()}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
              loading || !nsec.trim()
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-linear-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 shadow-lg shadow-amber-500/25'
            }`}
          >
            {loading ? 'Restoring...' : 'Restore Account'}
          </button>
        </div>

        <div className="text-center mt-6">
          <a href="/" className="text-slate-500 hover:text-slate-300 text-sm transition-colors">
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}
