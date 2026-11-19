import { describe, expect, it } from 'vitest'
import { alignExpansion, expansionContext, expansionRequest, finishExpansionContext, frameLine } from '../src/outpaint.js'
import type { ExpansionSide } from '../src/outpaint.js'
import { decodePixels, encodePixels, finishImageEdit, prepareImageEdit } from '../src/image-edit.js'
import type { Pixels } from '../src/pixels.js'
import { parseImageEdit } from '../src/shared/image-edit.js'
import type { ExpandMargins } from '../src/shared/image-edit.js'
import { parseSize } from '../src/shared/types.js'

function scene(width: number, height: number, dx = 0): Pixels {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, u = x + dx
    data.set([128 + 75 * Math.sin(u * 0.12) + 35 * Math.cos(y * 0.07), 125 + 80 * Math.cos(u * 0.07 + y * 0.12), 100 + 90 * Math.sin(u * 0.03 - y * 0.04), 255].map(v => Math.round(v)), i)
  }
  return { width, height, data }
}
const margins = (side: ExpansionSide, amount = 32): ExpandMargins => ({ left: 0, top: 0, right: 0, bottom: 0, [side]: amount })

describe('single-sided contextual expansion', () => {
  it.each(['left', 'right', 'top', 'bottom'] as const)('crops the %s edge and preserves every original RGBA byte after compositing', side => {
    const source = scene(240, 320)
    // Protect even invisible colors, not just visible RGB.
    source.data.set([75, 83, 91, 0], (100 * source.width + 100) * 4)
    const input = parseImageEdit({ operation: 'expand', image: 'item:aaaaaaaaaaaa', requestId: 'context-test', expand: margins(side) }, false)
    const prepared = prepareImageEdit(input, encodePixels(source)), context = prepared.expansion!
    expect(context.side).toBe(side)
    expect(context.source.width * context.source.height).toBeLessThan(source.width * source.height)
    const cropped = context.source, x = side === 'right' ? source.width - cropped.width : 0, y = side === 'bottom' ? source.height - cropped.height : 0
    for (let row = 0; row < cropped.height; row++) expect(cropped.data.subarray(row * cropped.width * 4, (row + 1) * cropped.width * 4)).toEqual(source.data.subarray(((row + y) * source.width + x) * 4, ((row + y) * source.width + x + cropped.width) * 4))
    const raw = scene(cropped.width + input.expand!.left + input.expand!.right, cropped.height + input.expand!.top + input.expand!.bottom)
    const output = decodePixels(finishImageEdit(prepared, { bytes: encodePixels(raw), width: raw.width, height: raw.height, mime: 'image/png' }).image.bytes)
    expect([output.width, output.height]).toEqual([prepared.width, prepared.height])
    for (let row = 0; row < source.height; row++) expect(output.data.subarray(((row + input.expand!.top) * output.width + input.expand!.left) * 4, ((row + input.expand!.top) * output.width + input.expand!.left + source.width) * 4)).toEqual(Buffer.from(source.data.subarray(row * source.width * 4, (row + 1) * source.width * 4)))
    expect([...output.data].filter((_, i) => i % 4 === 3 && output.data[i] === 0)).toHaveLength(1)
  })

  it('sends a single opaque RGB context at a valid aspect ratio, without copying a hidden center', () => {
    const source = scene(240, 640), context = expansionContext(source, margins('left', 32))!
    const request = expansionRequest(context, false, '\n用户补充要求：延续森林')
    expect(request.images).toHaveLength(1)
    const png = Buffer.from(request.images[0]!.split(',')[1]!, 'base64')
    expect(png[25]).toBe(2) // A true RGB PNG, not an all-opaque RGBA guide.
    expect(request.background).toBe('opaque')
    expect(request.prompt).toContain('仅向左')
    expect(request.prompt).toContain('延续森林')
    expect(() => parseSize(request.size, '2K')).not.toThrow()
    expect(context.source.width).toBe(80)
    expect(source.data).toEqual(scene(240, 640).data)
  })

  it('keeps the existing multi-sided API path and respects extreme input ratios', () => {
    expect(expansionContext(scene(80, 80), { left: 10, right: 10, top: 0, bottom: 0 })).toBeUndefined()
    for (const [w, h, side] of [[1600, 100, 'top'], [100, 1600, 'left'], [16, 16, 'right']] as const) {
      const c = expansionContext(scene(w, h), margins(side, 8))!
      expect(c.source.width / c.source.height).toBeGreaterThanOrEqual(1 / 16)
      expect(c.source.width / c.source.height).toBeLessThanOrEqual(16)
      expect(() => parseSize(expansionRequest(c, false, '').size, '2K')).not.toThrow()
    }
  })

  it('aligns a shifted scene but never stretches an unrelated result into a false match', () => {
    const source = scene(128, 192, 32), generated = scene(160, 192, 8)
    const aligned = alignExpansion(source, generated, 32, 0)
    expect(aligned.aligned).toBe(true)
    let before = 0, after = 0
    for (let y = 16; y < 176; y += 4) for (let x = 8; x < 120; x += 4) for (let c = 0; c < 3; c++) {
      const i = (y * source.width + x) * 4 + c, j = (y * generated.width + x + 32) * 4 + c
      before += Math.abs(source.data[i]! - generated.data[j]!); after += Math.abs(source.data[i]! - aligned.image.data[j]!)
    }
    expect(after).toBeLessThan(before * 0.2)
    const unrelated = { ...generated, data: new Uint8Array(generated.data.length).fill(255) }
    expect(alignExpansion(source, unrelated, 32, 0)).toEqual({ image: unrelated, aligned: false })
  })

  it('leaves a matching result intact beyond the narrow exterior seam band', () => {
    const source = scene(128, 192, 80), generated = scene(208, 192)
    const result = finishExpansionContext({ source, side: 'left', amount: 80 }, generated)
    expect(result.warnings).toEqual([])
    expect(result.aligned).toBe(false)
    expect(result.edgeError).toBe(0)
    for (let y = 0; y < 192; y++) {
      expect(result.image.data.subarray(y * 208 * 4, (y * 208 + 32) * 4)).toEqual(generated.data.subarray(y * 208 * 4, (y * 208 + 32) * 4))
      expect(result.image.data.subarray((y * 208 + 80) * 4, (y * 208 + 208) * 4)).toEqual(generated.data.subarray((y * 208 + 80) * 4, (y * 208 + 208) * 4))
    }
  })

  it('flags a mismatched overlap before any cosmetic seam correction', () => {
    const source = scene(128, 192), generated = { width: 160, height: 192, data: new Uint8Array(160 * 192 * 4).fill(255) }
    const result = finishExpansionContext({ source, side: 'left', amount: 32 }, generated)
    expect(result.warnings.join()).toContain('扩图需检查')
    expect(result.image.data).toEqual(generated.data)
  })

  it('marks missing exterior pixels and distorted output dimensions for review', () => {
    const source = scene(128, 192, 32), generated = scene(160, 192)
    generated.data[3] = 0
    expect(finishExpansionContext({ source, side: 'left', amount: 32 }, generated).warnings.join()).toContain('透明像素')
    expect(finishExpansionContext({ source, side: 'left', amount: 32 }, scene(200, 192)).warnings.join()).toContain('宽高比')
  })

  it('flags a straight frame drawn parallel to the seam, but not continuous scenery', () => {
    const source = scene(128, 192, 64), generated = scene(192, 192)
    expect(frameLine({ source, side: 'left', amount: 64 }, generated)).toBeLessThan(0.6)
    expect(finishExpansionContext({ source, side: 'left', amount: 64 }, generated).warnings).toEqual([])
    // A light panel starting 6 px outside the original, as in a real failed pass.
    const framed = { ...generated, data: new Uint8Array(generated.data) }
    for (let y = 0; y < 192; y++) for (let x = 0; x < 58; x++) framed.data.set([60, 60, 60], (y * 192 + x) * 4)
    expect(frameLine({ source, side: 'left', amount: 64 }, framed)).toBeGreaterThan(0.9)
    expect(finishExpansionContext({ source, side: 'left', amount: 64 }, framed).warnings.join()).toContain('平行的直线')
  })
})
