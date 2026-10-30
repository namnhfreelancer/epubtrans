import type { DomEnv } from '@epubtrans/core';

/** Browser-native DOM implementation injected into core (import, export). */
export function browserDomEnv(): DomEnv {
  return { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer };
}
