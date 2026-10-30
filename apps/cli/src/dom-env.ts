import type { DomEnv } from '@epubtrans/core';
import { DOMParser } from 'linkedom';

/** linkedom has no XMLSerializer; its nodes serialize themselves (XML syntax for XML documents). */
class LinkedomXMLSerializer {
  serializeToString(node: Node): string {
    return String(node);
  }
}

/** DOM implementation handed to core; core never reaches for DOM globals itself. */
export const domEnv: DomEnv = {
  DOMParser: DOMParser as unknown as typeof globalThis.DOMParser,
  XMLSerializer: LinkedomXMLSerializer as unknown as typeof globalThis.XMLSerializer,
};
