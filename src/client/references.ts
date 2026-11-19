import type { CanvasItem } from '../shared/types.js'

export const MAX_COMPOSER_REFS = 10
/** The main image (reference or edit target) is always 图1; duplicates are sent once, at most 10 in total. */
export function composerReferences(main: CanvasItem | undefined, extras: CanvasItem[]): CanvasItem[] {
  const seen = new Set<string>(), out: CanvasItem[] = []
  for (const item of [...(main ? [main] : []), ...extras]) if (!seen.has(item.id) && out.length < MAX_COMPOSER_REFS) { seen.add(item.id); out.push(item) }
  return out
}
