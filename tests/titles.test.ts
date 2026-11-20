import { describe, expect, it } from 'vitest'
import { labelOf, parseSize, RATIOS, titleFrom } from '../src/shared/types.js'
import { pendingShape } from '../src/client/Canvas.js'

describe('canvas labels', () => {
  it('derives short titles at a clause or word boundary', () => {
    expect(titleFrom('Draw a cross-section illustration of a tropical rainforest showing vertical stratification')).toBe('Draw a cross-section illustration…')
    expect(titleFrom('一只坐在苔藓石头上的红眼树蛙，自然博物插画风格')).toBe('一只坐在苔藓石头上的红眼树蛙')
    expect(titleFrom('一张精美的热带雨林动物分布图（infographic）')).toBe('一张精美的热带雨林动物分布图')
    expect(titleFrom('猫')).toBe('猫')
  })
  it('relabels items titled by the old 24-character prefix only', () => {
    const prompt = 'Draw a cross-section illustration of a tropical rainforest'
    expect(labelOf({ title: prompt.slice(0, 24), prompt })).toBe('Draw a cross-section illustration…')
    expect(labelOf({ title: '雨林垂直分层剖面图', prompt })).toBe('雨林垂直分层剖面图')
  })
  it('offers only ratio sizes supported by Seedream, and shapes placeholders to match', () => {
    for (const r of RATIOS) expect(parseSize(r.size, '2K')).toBe(r.size)
    expect(pendingShape('2560x1440', 900)).toEqual({ width: 900, height: 506 })
    expect(pendingShape('2K', 900)).toEqual({ width: 900, height: 900 })
  })
})
