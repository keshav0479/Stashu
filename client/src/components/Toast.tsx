import { useState, useCallback, useRef } from 'react';
import { Check, Info, X } from 'lucide-react';
import { ToastContext } from './useToast';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  exiting?: boolean;
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
  const styles = {
    success: {
      shell:
        'border-emerald-400/25 bg-emerald-500/10 text-emerald-50 shadow-[0_18px_60px_rgba(16,185,129,0.16)]',
      icon: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-300',
      Icon: Check,
    },
    error: {
      shell:
        'border-rose-400/25 bg-rose-500/10 text-rose-50 shadow-[0_18px_60px_rgba(244,63,94,0.16)]',
      icon: 'border-rose-300/25 bg-rose-400/10 text-rose-300',
      Icon: X,
    },
    info: {
      shell:
        'border-slate-500/30 bg-slate-800/80 text-slate-100 shadow-[0_18px_60px_rgba(15,23,42,0.32)]',
      icon: 'border-slate-400/20 bg-slate-400/10 text-slate-300',
      Icon: Info,
    },
  };
  const { Icon } = styles[toast.type];

  return (
    <div className="fixed top-5 right-4 left-4 sm:left-auto sm:right-5 z-50 pointer-events-none">
      <div
        className={`${styles[toast.type].shell} ${toast.exiting ? 'toast-exit' : 'toast-enter'}
                    pointer-events-auto ml-auto flex w-full max-w-sm items-center gap-3
                    rounded-xl border px-4 py-3 backdrop-blur-xl`}
      >
        <span
          className={`${styles[toast.type].icon} flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border`}
        >
          <Icon className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <p className="flex-1 text-sm font-semibold leading-snug">{toast.message}</p>
      </div>
    </div>
  );
}
