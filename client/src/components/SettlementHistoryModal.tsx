import { useEffect } from 'react';
import { X, History, ArrowRight } from 'lucide-react';
import type { SettlementLogEntry } from '../../../shared/types';

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface SettlementHistoryModalProps {
  settlements: SettlementLogEntry[];
  onClose: () => void;
}

export function SettlementHistoryModal({ settlements, onClose }: SettlementHistoryModalProps) {
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-slate-700/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
              <History className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Settlement History</h2>
              <p className="text-slate-400 text-xs">Recent withdrawals & auto-settlements</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto overscroll-contain">
          {settlements.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <History className="w-8 h-8 text-slate-600" />
              </div>
              <h3 className="text-slate-300 font-medium mb-1">No settlements yet</h3>
              <p className="text-slate-500 text-sm max-w-xs mx-auto">
                Withdrawals and auto-settlements will appear here once you start earning.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {settlements.map((s) => (
                <div
                  key={s.id}
                  className={`bg-slate-800/30 border rounded-xl p-4 transition-colors ${
                    s.status === 'success'
                      ? 'border-emerald-500/20 hover:border-emerald-500/30'
                      : s.status === 'failed'
                        ? 'border-rose-500/20 hover:border-rose-500/30'
                        : 'border-slate-700/50 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-1.5 max-w-[65%]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
                            s.status === 'success'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : s.status === 'failed'
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                : 'bg-slate-700/50 text-slate-400 border border-slate-600/50'
                          }`}
                        >
                          {s.status === 'success'
                            ? 'Sent'
                            : s.status === 'failed'
                              ? 'Failed'
                              : 'Skipped'}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">
                          {formatDate(s.createdAt)}
                        </span>
                      </div>

                      {s.lnAddress && s.status === 'success' && (
                        <div className="flex items-center gap-1.5" title={s.lnAddress}>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="text-xs font-mono text-slate-400 truncate">
                            {s.lnAddress}
                          </span>
                        </div>
                      )}
                      {s.error && (
                        <p className="text-rose-400/80 text-xs mt-1 bg-rose-500/5 p-1.5 rounded border border-rose-500/10 wrap-break-words">
                          Error: {s.error}
                        </p>
                      )}
                    </div>

                    <div className="text-right min-w-[35%] pl-2">
                      {s.netSats && s.status === 'success' ? (
                        <>
                          <div className="text-sm font-bold text-emerald-400 whitespace-nowrap">
                            +{s.netSats.toLocaleString()} sats
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 whitespace-nowrap">
                            Mint Fee: {s.feeSats} sats
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-slate-500">-</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
