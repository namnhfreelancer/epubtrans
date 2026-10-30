import { en, type MessageKey } from './messages-en';
import { vi } from './messages-vi';

export type Locale = 'en' | 'vi';
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'vi', label: 'Tiếng Việt' },
];
export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, vi };
export type MessageParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** Replaces `{name}` placeholders; unknown placeholders are left as-is so mistakes stay visible. */
export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  return formatMessage(MESSAGES[locale][key] ?? en[key], params);
}

export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'vi';

/** Vietnamese for vi-* browsers, English otherwise. */
export function localeFromLanguages(languages: readonly string[]): Locale {
  for (const lang of languages) {
    const base = lang.toLowerCase().split('-')[0];
    if (base === 'vi') return 'vi';
    if (base === 'en') return 'en';
  }
  return 'en';
}
