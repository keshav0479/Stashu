import { X, History } from 'lucide-react';
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
        <div className="p-6 overflow-y-auto custom-scrollbar">
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
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
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
                      {s.netSats && s.status === 'success' && (
                        <span className="text-sm font-bold text-emerald-400">
                          +{s.netSats.toLocaleString()} sats
                        </span>
                      )}
                    </div>
                    <span className="text-slate-500 text-xs font-mono">
                      {formatDate(s.createdAt)}
                    </span>
                  </div>

                  {s.status === 'success' && (
                    <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                      <span>Fee: {s.feeSats} sats</span>
                      <span className="font-mono truncate max-w-44 opacity-70">{s.lnAddress}</span>
                    </div>
                  )}

                  {s.error && (
                    <p className="text-rose-400/80 text-xs mt-2 bg-rose-500/5 p-2 rounded-lg border border-rose-500/10">
                      Error: {s.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
