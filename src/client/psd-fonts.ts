import type { TextStyle } from 'ag-psd'

const aliases: Record<string, string> = {
  Arial: 'ArialMT', Helvetica: 'Helvetica', 'Helvetica Neue': 'HelveticaNeue',
  'Times New Roman': 'TimesNewRomanPSMT', 'Courier New': 'CourierNewPSMT',
  Georgia: 'Georgia', Verdana: 'Verdana', Tahoma: 'Tahoma',
  'PingFang SC': 'PingFangSC-Regular', '苹方-简': 'PingFangSC-Regular',
  'Songti SC': 'STSongti-SC-Regular', '宋体-简': 'STSongti-SC-Regular',
  'Microsoft YaHei': 'MicrosoftYaHei', '微软雅黑': 'MicrosoftYaHei',
  SimSun: 'SimSun', '宋体': 'SimSun', SimHei: 'SimHei', '黑体': 'SimHei',
  'Noto Sans SC': 'NotoSansSC-Regular', 'Noto Serif SC': 'NotoSerifSC-Regular',
  Menlo: 'Menlo-Regular', Consolas: 'Consolas',
  'sans-serif': 'ArialMT', 'system-ui': 'ArialMT', serif: 'TimesNewRomanPSMT', monospace: 'CourierNewPSMT',
}
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u
const cjkFont = /PingFang|Songti|YaHei|SimSun|SimHei|Noto.*(?:SC|TC|CJK|JP|KR)|SourceHan|苹方|宋体|黑体|微软雅黑/i
export function psdFontName(family: string, text = ''): string {
  const families = family.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  let chosen = families[0] || 'Arial'
  if (cjk.test(text) && !cjkFont.test(chosen)) {
    chosen = families.find(f => cjkFont.test(f)) ?? (/serif/i.test(chosen) && !/sans/i.test(chosen) || /Georgia|Times/i.test(chosen) ? 'Songti SC' : 'PingFang SC')
  }
  return aliases[chosen] ?? chosen
}
/** CSS can fall back per glyph; PSD needs explicit font runs or CJK edits revert to a Latin font. */
export function psdFontRuns(text: string, family: string): Array<{ length: number; style: TextStyle }> {
  const runs: Array<{ length: number; style: TextStyle }> = []
  for (const character of text) {
    const name = psdFontName(family, character), last = runs.at(-1)
    if (last?.style.font?.name === name) last.length += character.length
    else runs.push({ length: character.length, style: { font: { name } } })
  }
  return runs
}
