interface AmountPickerProps {
  /** The stash price, which pay-what-you-want treats as the floor. */
  minSats: number;
  /** The text in the box; the parent parses and validates it. */
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  /** True while an invoice exists for the current amount. */
  locked: boolean;
  onChangeAmount: () => void;
}

function formatSats(sats: number): string {
  return sats.toLocaleString('en-US');
}

/**
 * The buyer's amount for a pay-what-you-want stash, shared by both payment
 * tabs. It locks while a Lightning invoice exists, so the number on screen is
 * always the number on the invoice.
 */
export function AmountPicker({
  minSats,
  value,
  onChange,
  error,
  locked,
  onChangeAmount,
}: AmountPickerProps) {
  const presets = [minSats, minSats * 2, minSats * 5];

  return (
    <div className="mb-6 rounded-2xl border border-slate-700 bg-slate-800/50 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <label htmlFor="pwyw-amount" className="font-medium text-slate-300">
          Choose your amount
        </label>
        <span className="text-xs text-slate-500">Minimum {formatSats(minSats)} sats</span>
      </div>

      <div className="mb-3 flex gap-2">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={locked}
            onClick={() => onChange(String(preset))}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              Number(value) === preset
                ? 'border-orange-500 bg-orange-500/10 text-white'
                : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-500 hover:text-white'
            }`}
          >
            {formatSats(preset)}
          </button>
        ))}
      </div>

      <div className="relative">
        <input
          id="pwyw-amount"
          type="number"
          inputMode="numeric"
          min={minSats}
          step={1}
          value={value}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'pwyw-amount-error' : undefined}
          className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 pr-14 text-white focus:border-orange-500 focus:outline-none disabled:opacity-60"
        />
        <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-slate-500">
          sats
        </span>
      </div>

      {error && (
        <p id="pwyw-amount-error" className="mt-2 text-sm text-rose-400">
          {error}
        </p>
      )}

      {locked && (
        <p className="mt-3 text-xs text-slate-500">
          Your invoice is for this amount.{' '}
          <button type="button" onClick={onChangeAmount} className="text-orange-400 underline">
            Change amount
          </button>
        </p>
      )}
    </div>
  );
}
