import { Link } from 'react-router-dom';
import { BarChart3, Key, Zap, Upload } from 'lucide-react';
import { hasIdentity } from './lib/identity';
import logo from './assets/logo.webp';
import './index.css';

function App() {
  const userHasIdentity = hasIdentity();

  return (
    <div className="min-h-screen h-screen grid grid-rows-[1fr_auto] p-4 md:p-8 pb-[env(safe-area-inset-bottom,16px)]">
      <div className="flex flex-col items-center justify-center gap-4 min-h-0">
        {/* Logo and Title */}
        <div className="text-center relative z-10">
          <div className="w-28 h-28 md:w-36 md:h-36 mx-auto mb-2 md:mb-4 logo-float drop-shadow-2xl">
            <img
              src={logo}
              alt="Stashu Squirrel"
              className="w-full h-full object-contain filter drop-shadow-lg"
            />
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white mb-2 md:mb-3 tracking-tight">
            Stash<span className="text-(--color-accent-primary)">u</span>
          </h1>
          <p className="text-lg text-(--color-text-secondary) max-w-md mx-auto leading-relaxed px-4">
            The{' '}
            <span className="text-(--color-text-primary) font-medium">blind vending machine</span>{' '}
            for the sovereign web.
          </p>
          <div className="flex items-center justify-center gap-3 mt-3">
            {userHasIdentity ? (
              <Link
                to="/dashboard"
                className="text-sm text-slate-400 hover:text-orange-400 transition-colors flex items-center gap-1.5"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Dashboard
              </Link>
            ) : (
              <Link
                to="/restore"
                className="text-sm text-slate-400 hover:text-orange-400 transition-colors flex items-center gap-1.5"
              >
                <Key className="w-3.5 h-3.5" />
                Restore Account
              </Link>
            )}
          </div>
        </div>

        <div className="w-full max-w-sm relative z-10 px-4">
          <div className="glass-card p-6 text-center hover:scale-[1.02] transition-transform group">
            <div className="w-12 h-12 mx-auto mb-4 bg-orange-500/10 rounded-xl flex items-center justify-center border border-orange-500/20 group-hover:border-orange-500/40 transition-colors">
              <Upload className="w-6 h-6 text-orange-400/80 group-hover:text-orange-400 transition-colors" />
            </div>
            <h2 className="text-xl font-bold mb-2">Sell a File</h2>
            <p className="text-(--color-text-secondary) text-sm mb-6">
              Upload, set price, get shareable link.
            </p>
            <Link
              to="/sell"
              className="btn-primary w-full shadow-lg shadow-orange-500/20 block text-center py-3 text-sm font-semibold tracking-wide hover:shadow-orange-500/30 hover:-translate-y-0.5 transition-all duration-200"
            >
              {userHasIdentity ? 'Create Stash' : 'Get Started'}
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="pt-3 pb-2 text-center relative z-10">
        <div className="flex items-center justify-center gap-6 mb-2">
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
