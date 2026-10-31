import { type ReactNode, useEffect, useRef } from 'react';
import { Button, type ButtonProps } from './button';

export interface DialogChoice<T extends string> {
  id: T;
  label: string;
  variant?: ButtonProps['variant'];
}

/**
 * Modal question with several answers (window.confirm only has OK/Cancel). Render it while the question is open; it
 * resolves through `onClose` with the chosen id, or undefined when dismissed (Escape or the cancel button).
 */
export function ChoiceDialog<T extends string>({
  title,
  children,
  choices,
  cancelLabel,
  onClose,
  testId,
}: {
  title: string;
  children: ReactNode;
  choices: DialogChoice<T>[];
  cancelLabel: string;
  onClose: (choice: T | undefined) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      closeRef.current(undefined);
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      data-testid={testId}
      aria-labelledby={testId ? `${testId}-title` : undefined}
      className="m-auto max-w-lg rounded-2xl border border-stone-200 bg-white p-5 text-stone-900 shadow-xl backdrop:bg-stone-950/40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
    >
      <h2 id={testId ? `${testId}-title` : undefined} className="text-base font-semibold">
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm text-stone-700 dark:text-stone-300">{children}</div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => onClose(undefined)} data-testid={testId ? `${testId}-cancel` : undefined}>
          {cancelLabel}
        </Button>
        {choices.map((c) => (
          <Button key={c.id} variant={c.variant ?? 'secondary'} onClick={() => onClose(c.id)} data-testid={testId ? `${testId}-${c.id}` : undefined}>
            {c.label}
          </Button>
        ))}
      </div>
    </dialog>
  );
}
