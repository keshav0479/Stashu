import { useState, createContext, useContext, useCallback, useRef } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  exiting?: boolean;
}

interface ToastContextType {
  showToast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const id = Math.random().toString(36).slice(2);
    setToast({ id, message, type });

    timeoutRef.current = setTimeout(() => {
      setToast((prev) => (prev ? { ...prev, exiting: true } : null));
      setTimeout(() => setToast(null), 250);
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && <ToastItem toast={toast} />}
    </ToastContext.Provider>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const bgColors = {
    success: 'bg-emerald-600',
    error: 'bg-rose-600',
    info: 'bg-slate-700',
  };

  const icons = {
    success: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    info: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
  };

  return (
    <div className="fixed top-6 right-6 z-50 pointer-events-none">
      <div
        className={`${bgColors[toast.type]} ${toast.exiting ? 'toast-exit' : 'toast-enter'}
                    text-white px-5 py-3.5 rounded-2xl shadow-2xl
                    flex items-center gap-3 min-w-70 max-w-sm
                    pointer-events-auto border border-white/10`}
      >
        <span className="text-white/90">{icons[toast.type]}</span>
        <p className="flex-1 text-sm font-semibold tracking-wide">{toast.message}</p>
      </div>
    </div>
  );
}
