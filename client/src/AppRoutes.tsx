import type { ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import App from './App';
import {
  DashboardPage,
  RestorePage,
  SellPage,
  SettingsPage,
  StorefrontPage,
  UnlockPage,
} from './components';
import NotFoundPage from './components/NotFoundPage';

function RouteTransition({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div key={location.pathname} className="route-appear">
      {children}
    </div>
  );
}

export function AppRoutes() {
  return (
    <RouteTransition>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/sell" element={<SellPage />} />
        <Route path="/s/:id" element={<UnlockPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/restore" element={<RestorePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/p/:npub" element={<StorefrontPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </RouteTransition>
  );
}
