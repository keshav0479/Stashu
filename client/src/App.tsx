import { Link } from 'react-router-dom';
import { BarChart3, Key, Lock, CloudUpload, Zap, LockOpen, Check, Upload } from 'lucide-react';
import { hasIdentity } from './lib/identity';
import logo from './assets/logo.webp';
import './index.css';

function App() {
  const userHasIdentity = hasIdentity();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      {/* Top Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 p-4">
        <div className="max-w-4xl mx-auto flex justify-end gap-4">
          {userHasIdentity ? (
            <Link
              to="/dashboard"
              className="px-4 py-2 rounded-xl bg-slate-800/80 backdrop-blur-sm text-slate-300 hover:text-white hover:bg-slate-700/80 transition-all text-sm font-medium flex items-center gap-2"
            >
              <BarChart3 className="w-4 h-4" />
              Dashboard
            </Link>
          ) : (
            <Link
              to="/restore"
              className="px-4 py-2 rounded-xl bg-slate-800/80 backdrop-blur-sm text-slate-300 hover:text-white hover:bg-slate-700/80 transition-all text-sm font-medium flex items-center gap-2"
            >
              <Key className="w-4 h-4" />
              Restore
            </Link>
          )}
        </div>
      </nav>

      {/* Logo and Title */}
      <div className="text-center mb-16 relative z-10">
        <div className="w-40 h-40 mx-auto mb-6 logo-float drop-shadow-2xl">
          <img
            src={logo}
            alt="Stashu Squirrel"
            className="w-full h-full object-contain filter drop-shadow-lg"
          />
        </div>

        <div className="inline-block mb-3 px-4 py-1.5 rounded-full border border-(--color-border) bg-(--color-bg-glass) backdrop-blur-md">
          <span className="text-xs font-medium text-(--color-accent-primary) tracking-wider uppercase">
            V 1.0 • Alpha
          </span>
        </div>

        <h1 className="text-6xl md:text-7xl font-bold text-white mb-6 tracking-tight">
          Stash<span className="text-(--color-accent-primary)">u</span>
        </h1>
        <p className="text-xl text-(--color-text-secondary) max-w-lg mx-auto leading-relaxed font-light">
          The <span className="text-(--color-text-primary) font-medium">blind vending machine</span>{' '}
          for the sovereign web.
        </p>
      </div>

      {/* Main Action */}
      <div className="w-full max-w-md relative z-10 px-4">
        <div className="glass-card p-10 text-center hover:scale-[1.02] transition-transform group">
          <div className="w-16 h-16 mx-auto mb-6 bg-linear-to-br from-orange-500/20 to-orange-500/5 rounded-2xl flex items-center justify-center border border-orange-500/20 group-hover:border-orange-500/40 transition-colors">
            <Upload className="w-8 h-8 text-orange-400" />
          </div>
          <h2 className="text-2xl font-bold mb-3">Sell a File</h2>
          <p className="text-(--color-text-secondary) text-base mb-8 leading-relaxed">
            Upload your asset, set a price in sats, and get a shareable link.
          </p>
          <Link to="/sell" className="btn-primary w-full shadow-orange-500/20 block text-center">
            {userHasIdentity ? 'Create Stash' : 'Get Started'}
          </Link>
        </div>
      </div>

      {/* How it Works */}
      <div className="max-w-4xl w-full mt-16 px-4 relative z-10">
        <div className="glass-card p-8">
          <h3 className="text-xl font-bold text-white mb-6 text-center">How Stashu Works</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <Lock className="w-6 h-6 text-orange-400" />
              </div>
              <p className="text-sm text-slate-400">
                Files encrypted
                <br />
                in your browser
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <CloudUpload className="w-6 h-6 text-orange-400" />
              </div>
              <p className="text-sm text-slate-400">
                Stored on
                <br />
                Blossom
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <Zap className="w-6 h-6 text-orange-400" />
              </div>
              <p className="text-sm text-slate-400">
                Buyer pays
                <br />
                with Bitcoin
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <LockOpen className="w-6 h-6 text-orange-400" />
              </div>
              <p className="text-sm text-slate-400">
                Key released,
                <br />
                file decrypts
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-4 mt-6 pt-6 border-t border-slate-700">
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-400" />
              No accounts
            </span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-400" />
              No tracking
            </span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-400" />
              No KYC
            </span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-400" />
              E2E encrypted
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-16 text-center relative z-10">
        <div className="flex items-center justify-center gap-6 mb-4">
          <a
            href="https://github.com/keshav0479/Stashu"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            Open Source
          </a>
          <span className="text-slate-700">•</span>
          <a
            href="lightning:abruptalibi13@walletofsatoshi.com"
            className="flex items-center gap-2 text-slate-400 hover:text-amber-400 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Support
          </a>
        </div>
        <p className="text-xs text-slate-600">
          100% client-side encryption • Your keys, your files
        </p>
      </footer>
    </div>
  );
}

export default App;
