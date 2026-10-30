import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 dark:hover:bg-teal-600',
  secondary:
    'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800',
  ghost: 'text-stone-700 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800',
  danger: 'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  const sizing = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm';
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
