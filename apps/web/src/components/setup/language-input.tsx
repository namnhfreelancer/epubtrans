import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { COMMON_LANGUAGES, languageLabel, normalizeLanguageTag } from '../../lib/languages';
import { INPUT_CLASS } from '../ui/input-class';
import { Field } from '../ui/layout-primitives';

interface LanguageInputProps {
  id: string;
  label: string;
  value: string;
  allowAuto?: boolean;
  /** Commit only when the field loses focus (or on Enter), not on every valid tag typed: for changes that ask a question. */
  commitOnBlur?: boolean;
  onCommit: (tag: string) => void;
}

/** Searchable language list (datalist) that also accepts any valid BCP 47 tag typed in. */
export function LanguageInput({ id, label, value, allowAuto = false, commitOnBlur = false, onCommit }: LanguageInputProps) {
  const { t, locale } = useI18n();
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(value);
    setInvalid(false);
  }, [value]);

  const resolve = (input: string): string | undefined => {
    if (allowAuto && (input.trim() === '' || input.trim().toLowerCase() === 'auto')) return 'auto';
    return normalizeLanguageTag(input);
  };

  const onChange = (input: string) => {
    setText(input);
    setInvalid(false);
    const tag = resolve(input);
    if (!commitOnBlur && tag && tag !== value) onCommit(tag);
  };

  const onBlur = () => {
    const tag = resolve(text);
    if (!tag) return setInvalid(true);
    setText(tag);
    if (commitOnBlur && tag !== value) onCommit(tag);
  };

  const current = value === 'auto' ? t('setup.auto') : languageLabel(value, locale);
  return (
    <Field label={label} htmlFor={id} hint={`${current} · ${t('setup.langHint')}`} error={invalid ? t('setup.langInvalid') : undefined}>
      <input
        id={id}
        list={`${id}-options`}
        className={INPUT_CLASS}
        autoComplete="off"
        spellCheck={false}
        value={text}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (!commitOnBlur || e.key !== 'Enter') return;
          // Without preventDefault the same key press would activate the first button of a dialog the commit opens.
          e.preventDefault();
          e.currentTarget.blur();
        }}
      />
      <datalist id={`${id}-options`}>
        {allowAuto && <option value="auto">{t('setup.auto')}</option>}
        {COMMON_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {languageLabel(code, locale)}
          </option>
        ))}
      </datalist>
    </Field>
  );
}
