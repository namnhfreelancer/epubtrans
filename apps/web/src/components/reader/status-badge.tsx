import type { SegmentStatus } from '@epubtrans/core';
import { useI18n } from '../../i18n/i18n-context';

const STYLES: Record<SegmentStatus, string> = {
  pending: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  translated: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  reviewed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

export function StatusBadge({ status }: { status: SegmentStatus }) {
  const { t } = useI18n();
  return (
    <span data-testid="segment-status" data-status={status} className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STYLES[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}
