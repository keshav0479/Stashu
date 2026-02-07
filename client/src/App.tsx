import { Link } from 'react-router-dom';
import logo from './assets/logo.webp';
import './index.css';

function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
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

      {/* Action Cards */}
      <div className="flex flex-col md:flex-row gap-8 w-full max-w-4xl relative z-10 px-4">
        {/* Seller Card */}
        <div className="glass-card p-10 flex-1 text-center hover:scale-[1.02] transition-transform group">
          <div className="w-16 h-16 mx-auto mb-6 bg-linear-to-br from-orange-500/20 to-orange-500/5 rounded-2xl flex items-center justify-center border border-orange-500/20 group-hover:border-orange-500/40 transition-colors">
            <span className="text-3xl">📤</span>
          </div>
          <h2 className="text-2xl font-bold mb-3">Sell a File</h2>
          <p className="text-(--color-text-secondary) text-base mb-8 leading-relaxed">
            Upload your asset, set a price in sats, and get a shareable link.
          </p>
          <Link to="/sell" className="btn-primary w-full shadow-orange-500/20 block text-center">
            Connect Wallet
          </Link>
        </div>

        {/* Buyer Card */}
        <div className="glass-card p-10 flex-1 text-center hover:scale-[1.02] transition-transform group">
          <div className="w-16 h-16 mx-auto mb-6 bg-linear-to-br from-indigo-500/20 to-indigo-500/5 rounded-2xl flex items-center justify-center border border-indigo-500/20 group-hover:border-indigo-500/40 transition-colors">
            <span className="text-3xl">🔓</span>
          </div>
          <h2 className="text-2xl font-bold mb-3">Unlock a File</h2>
          <p className="text-(--color-text-secondary) text-base mb-8 leading-relaxed">
            Paste a Cashu token to instantly decrypt and download content.
          </p>
          <Link
            to="/s/demo"
            className="btn-secondary w-full shadow-indigo-500/20 block text-center"
          >
            Have a Link?
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-16 text-center text-sm text-(--color-text-secondary) relative z-10">
        <p className="mb-2">Powered by Blossom • Cashu • NIP-44</p>
        <p className="opacity-50">No accounts. No tracking. Just files and sats.</p>
      </footer>
    </div>
  );
}

export default App;
