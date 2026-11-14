import { describe, expect, it } from 'vitest'
import { psdFontName, psdFontRuns } from '../src/client/psd-fonts.js'

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
})
