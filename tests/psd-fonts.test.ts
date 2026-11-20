import { describe, expect, it } from 'vitest'
import { psdFontName, psdFontRuns } from '../src/client/psd-fonts.js'
import { fontStack, ocrFont, OCR_FONT_COUNT } from '../src/shared/fonts.js'

describe('PSD font fallback', () => {
  it('uses PostScript names and resolves generic font stacks', () => {
    expect(psdFontName('"Times New Roman", serif')).toBe('TimesNewRomanPSMT')
    expect(psdFontName('sans-serif')).toBe('ArialMT')
    expect(psdFontName('Arial, Microsoft YaHei, sans-serif', '中文')).toBe('MicrosoftYaHei')
    expect(psdFontName('Georgia, Songti SC, serif', '中文')).toBe('STSongti-SC-Regular')
  })
  it('records CSS per-glyph fallback with UTF-16 run lengths', () => {
    const runs = psdFontRuns('ABC中文🙂', 'Arial, PingFang SC, sans-serif')
    expect(runs.map(r => [r.length, r.style.font!.name])).toEqual([[3, 'ArialMT'], [2, 'PingFangSC-Regular'], [2, 'ArialMT']])
    expect(runs.reduce((n, r) => n + r.length, 0)).toBe('ABC中文🙂'.length)
  })
  it('maps every supported OCR font, including Chinese names, to PostScript and CSS fallbacks', () => {
    expect(OCR_FONT_COUNT).toBe(228)
    expect(psdFontName('苹方', '科研绘图')).toBe('PingFangSC-Regular')
    expect(psdFontName('思源黑体', '中文')).toBe('SourceHanSansCN-Regular')
    expect(psdFontName('华文楷体', '中文')).toBe('STKaiti')
    expect(psdFontName('Cal Sans', 'AI4Scholar')).toBe('CalSans-SemiBold')
    expect(psdFontName('Barlow', '中文')).toBe('PingFangSC-Regular')
    // A listed font without a known PostScript name falls back within its category.
    expect(psdFontName('汉仪颜楷', '楷书')).toBe('STKaitiSC-Regular')
    expect(psdFontName('站酷文艺体', '手写')).toBe('STXingkaiSC-Light')
    expect(ocrFont('funny & cute')?.name).toBe('Funny & Cute')
    expect(ocrFont('Unknown Font')).toBeUndefined()
    const stack = fontStack('方正小标宋')
    expect(stack.startsWith('"方正小标宋"')).toBe(true)
    expect(stack).toContain('"Songti SC"')
    expect(stack.endsWith('serif')).toBe(true)
    expect(fontStack('Alex Brush').endsWith('cursive')).toBe(true)
  })
})

