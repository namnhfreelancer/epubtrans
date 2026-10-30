import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/messages-en';
import { vi } from '../src/i18n/messages-vi';
import { formatMessage, localeFromLanguages, MESSAGES, translate } from '../src/i18n/translate-message';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n dictionaries', () => {
  it('have identical key sets in every locale', () => {
    const enKeys = Object.keys(en).sort();
    for (const [locale, messages] of Object.entries(MESSAGES)) {
      expect(Object.keys(messages).sort(), locale).toEqual(enKeys);
    }
  });

  it('have no empty strings', () => {
    for (const messages of Object.values(MESSAGES)) {
      for (const [key, value] of Object.entries(messages)) expect(value.trim(), key).not.toBe('');
    }
  });

  it('use the same placeholders in every locale', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(vi[key]), key).toEqual(placeholders(en[key]));
    }
  });
});

describe('formatMessage', () => {
  it('replaces known placeholders and keeps unknown ones visible', () => {
    expect(formatMessage('{done} / {total} and {missing}', { done: 3, total: 10 })).toBe('3 / 10 and {missing}');
  });

  it('translates with parameters', () => {
    expect(translate('vi', 'library.progress', { done: 1, total: 2 })).toBe('1 / 2 đoạn');
    expect(translate('en', 'library.progress', { done: 1, total: 2 })).toBe('1 / 2 segments');
  });
});

describe('localeFromLanguages', () => {
  it('picks Vietnamese for vi browsers and English otherwise', () => {
    expect(localeFromLanguages(['vi-VN', 'en-US'])).toBe('vi');
    expect(localeFromLanguages(['en-GB'])).toBe('en');
    expect(localeFromLanguages(['fr-FR', 'vi'])).toBe('vi');
    expect(localeFromLanguages(['de-DE'])).toBe('en');
    expect(localeFromLanguages([])).toBe('en');
  });
});
