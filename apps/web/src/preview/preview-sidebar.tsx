import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { INPUT_CLASS } from '../components/ui/input-class';
import { errorText } from '../lib/notices';
import { usePreviewText } from './preview-messages';
import type { PreviewReaderController } from './preview-reader-controller';
import type { TocItem } from './third-party/foliate-js/epub.js';
import type { SearchMatch } from './third-party/foliate-js/view.js';

function TocList({ items, current, onSelect, depth = 0 }: { items: TocItem[]; current?: string; onSelect: (href: string) => void; depth?: number }) {
  return (
    <ul className={depth > 0 ? 'ms-3 border-s border-stone-200 ps-2 dark:border-stone-800' : ''}>
      {items.map((item) => (
        <li key={`${item.href}|${item.label}`}>
          <button
            type="button"
            data-testid="preview-toc-item"
            aria-current={item.href === current ? 'true' : undefined}
            onClick={() => onSelect(item.href)}
            className={`block w-full rounded-md px-2 py-1 text-start text-sm transition ${
              item.href === current
                ? 'bg-teal-50 font-medium text-teal-900 dark:bg-teal-950/50 dark:text-teal-200'
                : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
            }`}
          >
            {item.label.trim() || item.href}
          </button>
          {item.subitems?.length ? <TocList items={item.subitems} current={current} onSelect={onSelect} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

interface SearchState {
  query: string;
  matches: SearchMatch[];
  /** 0..1 while running, 1 when done. */
  progress: number;
  error?: string;
}

/** Full-text search over the rendered book; results jump to their location (foliate also outlines them). */
function PreviewSearch({ controller }: { controller: PreviewReaderController | undefined }) {
  const p = usePreviewText();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>();
  const run = useRef(0);

  // A search in flight stops when the panel goes away.
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const text = query.trim();
    const ticket = ++run.current;
    controller?.clearSearch();
    if (!text || !controller) return setState(undefined);
    const matches: SearchMatch[] = [];
    setState({ query: text, matches, progress: 0 });
    try {
      for await (const event of controller.search(text) ?? []) {
        if (ticket !== run.current) return;
        if (event === 'done') break;
        if ('subitems' in event) matches.push(...event.subitems);
        setState({ query: text, matches: [...matches], progress: 'progress' in event ? event.progress : 0 });
      }
      if (ticket === run.current) setState({ query: text, matches, progress: 1 });
    } catch (err) {
      if (ticket === run.current) setState({ query: text, matches, progress: 1, error: errorText(err) });
    }
  };

  const clear = () => {
    run.current++;
    setQuery('');
    setState(undefined);
    controller?.clearSearch();
  };

  return (
    <search className="block space-y-2">
      <form onSubmit={(e) => void search(e)} className="flex gap-1.5">
        <input
          type="search"
          data-testid="preview-search-input"
          aria-label={p('preview.searchPlaceholder')}
          placeholder={p('preview.searchPlaceholder')}
          className={`${INPUT_CLASS} py-1.5`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" size="sm" data-testid="preview-search-submit" disabled={!controller}>
          {p('preview.search')}
        </Button>
      </form>
      {state && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
            <span data-testid="preview-search-status" aria-live="polite">
              {state.error
                ? p('preview.failed', { message: state.error })
                : state.progress < 1
                  ? p('preview.searching', { percent: Math.round(state.progress * 100) })
                  : state.matches.length
                    ? p('preview.searchResults', { n: state.matches.length })
                    : p('preview.noResults')}
            </span>
            <button type="button" className="text-teal-700 hover:underline dark:text-teal-400" onClick={clear}>
              {p('preview.clearSearch')}
            </button>
          </div>
          <ol className="max-h-80 space-y-1 overflow-y-auto">
            {state.matches.map((m) => (
              <li key={m.cfi}>
                <button
                  type="button"
                  data-testid="preview-search-result"
                  onClick={() => void controller?.goTo(m.cfi)}
                  className="block w-full rounded-md px-2 py-1 text-start text-xs text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                >
                  {m.excerpt.pre}
                  <mark className="rounded bg-amber-200 px-0.5 text-stone-900 dark:bg-amber-700 dark:text-stone-50">{m.excerpt.match}</mark>
                  {m.excerpt.post}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </search>
  );
}

/** Table of contents (current entry marked) and search. */
export function PreviewSidebar({ controller, toc, currentHref }: { controller: PreviewReaderController | undefined; toc: TocItem[]; currentHref?: string }) {
  const p = usePreviewText();
  return (
    <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
      <PreviewSearch controller={controller} />
      <nav aria-label={p('preview.contents')} data-testid="preview-toc">
        <h2 className="mb-1 text-sm font-semibold">{p('preview.contents')}</h2>
        {toc.length ? (
          <div className="max-h-[50vh] overflow-y-auto">
            <TocList items={toc} current={currentHref} onSelect={(href) => void controller?.goTo(href)} />
          </div>
        ) : (
          <p className="text-xs text-stone-500 dark:text-stone-400">{p('preview.noContents')}</p>
        )}
      </nav>
    </aside>
  );
}
