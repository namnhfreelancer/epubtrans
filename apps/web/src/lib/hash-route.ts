import { useSyncExternalStore } from 'react';

/**
 * Hash-based routing: works on GitHub Pages under any base path without a 404 fallback.
 * Routes: `#/`, `#/settings`, `#/book/<id>/<tab>`, and `#/book/<id>/read/<segmentId>` to open the reader on one segment.
 */
export type BookTab = 'setup' | 'read' | 'export';
export type Route = { name: 'library' } | { name: 'settings' } | { name: 'book'; id: string; tab: BookTab; segment?: string };

const TABS: BookTab[] = ['setup', 'read', 'export'];

export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'book' && parts[1]) {
    const tab = TABS.find((t) => t === parts[2]) ?? 'setup';
    const segment = tab === 'read' ? parts[3] : undefined;
    return segment ? { name: 'book', id: parts[1], tab, segment } : { name: 'book', id: parts[1], tab };
  }
  return { name: 'library' };
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'library':
      return '#/';
    case 'settings':
      return '#/settings';
    case 'book':
      return `#/book/${encodeURIComponent(route.id)}/${route.tab}${route.tab === 'read' && route.segment ? `/${encodeURIComponent(route.segment)}` : ''}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = routeHref(route);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}
