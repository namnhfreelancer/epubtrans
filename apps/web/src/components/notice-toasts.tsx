import { useI18n } from '../i18n/i18n-context';
import { useExternalStore } from '../lib/external-store';
import { dismissNotice, notices } from '../lib/notices';

const STYLES = {
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  info: 'border-stone-300 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100',
};

export function NoticeToasts() {
  const list = useExternalStore(notices);
  const { t } = useI18n();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {list.map((n) => (
        <div
          key={n.id}
          role={n.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${STYLES[n.kind]}`}
        >
          <p className="flex-1 break-words">{n.text}</p>
          <button type="button" onClick={() => dismissNotice(n.id)} className="text-xs font-medium opacity-70 hover:opacity-100">
            {t('common.dismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
