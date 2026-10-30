import type { ReactNode } from 'react';

/** Card section with an optional heading and actions. */
export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5 dark:border-stone-800 dark:bg-stone-900 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Label + control + hint. `htmlFor` ties the label to the control for accessibility. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-red-700 dark:text-red-400">{error}</p> : hint && <p className="text-xs text-stone-500 dark:text-stone-400">{hint}</p>}
    </div>
  );
}

const ALERT_STYLES = {
  info: 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-100',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100',
  error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100',
} as const;

export function Alert({ kind = 'info', children }: { kind?: keyof typeof ALERT_STYLES; children: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${ALERT_STYLES[kind]}`}>
      {children}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
    >
      <div className="h-full rounded-full bg-teal-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}
