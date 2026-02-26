import { Link } from 'react-router-dom';

function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-bold text-(--color-accent-primary) mb-4">404</div>
        <h1 className="text-2xl font-bold text-white mb-3">Stash Not Found</h1>
        <p className="text-(--color-text-secondary) mb-8 leading-relaxed">
          This page doesn't exist. Maybe the stash was removed, or you followed a broken link.
        </p>
        <Link
          to="/"
          className="btn-primary inline-block px-8 py-3 text-sm font-semibold tracking-wide"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
