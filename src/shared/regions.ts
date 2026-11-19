/** A region in source pixels. */
export interface PixelBox { x: number; y: number; width: number; height: number }
export const MAX_REGIONS = 16
/**
 * Ark coordinate tags use normalized integers in [0, 1000], ordered left, top, right, bottom,
 * with the origin at the image's top-left corner.
 */
export function bboxTag(box: PixelBox, width: number, height: number): string {
  const n = (v: number, total: number) => Math.max(0, Math.min(1000, Math.round(v / total * 1000)))
  const left = n(box.x, width), top = n(box.y, height), right = Math.max(left + 1, n(box.x + box.width, width)), bottom = Math.max(top + 1, n(box.y + box.height, height))
  return `<bbox>${left} ${top} ${Math.min(1000, right)} ${Math.min(1000, bottom)}</bbox>`
}
/** Drop degenerate boxes and clip to the image; at most MAX_REGIONS survive. */
export function cleanRegions(boxes: PixelBox[], width: number, height: number): PixelBox[] {
  return boxes.map(b => {
    const x = Math.max(0, Math.min(width, b.x)), y = Math.max(0, Math.min(height, b.y))
    return { x, y, width: Math.min(width, b.x + b.width) - x, height: Math.min(height, b.y + b.height) - y }
  }).filter(b => b.width >= 2 && b.height >= 2).slice(0, MAX_REGIONS)
}
/** Decomposition prompt: the user's note plus explicit regions to separate. */
export function decomposePrompt(note: string, boxes: PixelBox[], width: number, height: number): string {
  const regions = cleanRegions(boxes, width, height)
  if (!regions.length) return note
  return `${note.trim()}\n需要单独拆分的区域坐标为${regions.map(b => bboxTag(b, width, height)).join('、')}，每个区域内的主要元素各自成为独立图层。`
}
