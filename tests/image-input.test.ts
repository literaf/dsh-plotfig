import { describe, expect, it } from 'vitest'
import { imageInfo } from '../src/image-data.js'
import { parseGenerate, parseSize } from '../src/shared/types.js'
import { png } from './fixtures.js'

describe('size and input validation', () => {
  it('accepts tiers and pixel-bounded WxH, never both', () => {
    expect(parseSize(undefined, '2K')).toBe('2K'); expect(parseSize('1.5k', '2K')).toBe('1.5K'); expect(parseSize('2560×1440', '2K')).toBe('2560x1440')
    for (const bad of ['4K', '2K 2048x2048', '100x100', '4000x4000', '4800x200', 12]) expect(() => parseSize(bad, '2K')).toThrow()
  })
  it('limits references, prompt length and types', () => {
    const defaults = { size: '2K', watermark: true }
    expect(parseGenerate({ prompt: ' x ', title: ' 标题 ' }, defaults)).toEqual({ prompt: 'x', model: 'seedream55', images: [], size: '2K', watermark: true, title: '标题' })
    for (const bad of [{}, { prompt: '' }, { prompt: 'x'.repeat(4001) }, { prompt: 'x', images: Array(11).fill('item:aaaaaaaaaaaa') }, { prompt: 'x', images: [1] }, { prompt: 'x', watermark: 'no' }]) expect(() => parseGenerate(bad, defaults)).toThrow()
  })
  it('reads PNG and JPEG dimensions', () => {
    expect(imageInfo(png(1330, 1773))).toEqual({ width: 1330, height: 1773, mime: 'image/png' })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x02, 0x00, 0x03, 0x00, 3, 0, 0])
    expect(imageInfo(jpeg)).toEqual({ width: 768, height: 512, mime: 'image/jpeg' })
    expect(imageInfo(new TextEncoder().encode('<html>not an image</html>'))).toBeUndefined()
  })
})
