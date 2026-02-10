import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import {
  SellPage,
  UnlockPage,
  DashboardPage,
  RestorePage,
  SettingsPage,
  ToastProvider,
} from './components';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/sell" element={<SellPage />} />
          <Route path="/s/:id" element={<UnlockPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/restore" element={<RestorePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>
);
