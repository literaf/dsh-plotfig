/**
 * Fonts returned by Seedream 5.5 rich-text OCR (`similar_font_family`), per the Ark
 * "OCR 支持字体" list (2026-10-27): 101 Chinese and 127 other families. Each name maps
 * to a category for the closest fallback, and, where the PostScript name is well known,
 * to that name so PSD readers can find the installed font.
 */
export type FontCategory = 'sans' | 'serif' | 'kai' | 'fangsong' | 'round' | 'display' | 'script' | 'mono'

/** [category, PostScript name of the regular face, CSS family names to try first] */
type Entry = readonly [FontCategory, (string | undefined)?, ...string[]]
const F: Record<string, Entry> = {
  // Chinese
  思源黑体: ['sans', 'SourceHanSansCN-Regular', 'Source Han Sans CN', 'Source Han Sans SC', 'Noto Sans CJK SC'],
  思源宋体: ['serif', 'SourceHanSerifCN-Regular', 'Source Han Serif CN', 'Source Han Serif SC', 'Noto Serif CJK SC'],
  阿里巴巴普惠体: ['sans', 'AlibabaPuHuiTi-Regular', 'Alibaba PuHuiTi'],
  华文楷体: ['kai', 'STKaiti', 'STKaiti'],
  苹方: ['sans', 'PingFangSC-Regular', 'PingFang SC'],
  'HarmonyOS Sans': ['sans', 'HarmonyOS_Sans_SC', 'HarmonyOS Sans SC', 'HarmonyOS Sans'],
  微软雅黑: ['sans', 'MicrosoftYaHei', 'Microsoft YaHei'],
  宋体: ['serif', 'SimSun', 'SimSun', 'Songti SC'],
  等线: ['sans', 'DengXian-Regular', 'DengXian'],
  黑体: ['sans', 'SimHei', 'SimHei', 'Heiti SC'],
  方正清刻本悦宋: ['serif'],
  华文细黑: ['sans', 'STXihei', 'STXihei'],
  方正兰亭黑: ['sans', 'FZLTXHK--GBK1-0', 'Lantinghei SC'],
  'Arial Unicode MS': ['sans', 'ArialUnicodeMS', 'Arial Unicode MS'],
  微软正黑体: ['sans', 'MicrosoftJhengHeiRegular', 'Microsoft JhengHei'],
  方正姚体: ['display', 'FZYaoti', 'FZYaoTi'],
  楷体: ['kai', 'KaiTi', 'KaiTi', 'Kaiti SC'],
  华文中宋: ['serif', 'STZhongsong', 'STZhongsong'],
  仿宋: ['fangsong', 'FangSong', 'FangSong', 'STFangsong'],
  幼圆: ['round', 'YouYuan', 'YouYuan', 'Yuanti SC'],
  方正正黑: ['sans'],
  华文黑体: ['sans', 'STHeiti', 'STHeiti'],
  华文行楷: ['script', 'STXingkai', 'STXingkai', 'Xingkai SC'],
  汉仪尚巍手书: ['script'],
  冬青黑体: ['sans', 'HiraginoSansGB-W3', 'Hiragino Sans GB'],
  方正小标宋: ['serif', 'FZXiaoBiaoSong-B05S'],
  汉仪雅酷黑: ['display'],
  汉仪正圆: ['round'],
  优设标题黑: ['display'],
  方正大标宋: ['serif'],
  方正粗黑宋: ['serif'],
  新细明体: ['serif', 'PMingLiU', 'PMingLiU'],
  华文新魏: ['kai', 'STXinwei', 'STXinwei'],
  汉仪润圆: ['round'],
  汉仪菱心体: ['display'],
  造字工房力黑: ['display'],
  方正宋刻本秀楷: ['kai'],
  华文隶书: ['display', 'STLiti', 'STLiti', 'Libian SC'],
  方正尚酷: ['display'],
  华文琥珀: ['display', 'STHupo', 'STHupo'],
  隶书: ['display', 'LiSu', 'LiSu', 'Libian SC'],
  MiSans: ['sans', 'MiSans-Regular', 'MiSans'],
  '字魂59号-创粗黑': ['display'],
  方正大黑: ['sans'],
  方正综艺: ['display'],
  OPPOSans: ['sans', 'OPPOSans-R', 'OPPOSans'],
  兰亭黑: ['sans', 'FZLTXHK--GBK1-0', 'Lantinghei SC'],
  汉仪力量黑: ['display'],
  华文宋体: ['serif', 'STSong', 'STSong'],
  汉仪超级战甲: ['display'],
  文道潮黑: ['display'],
  方正公文小标宋: ['serif'],
  华文仿宋: ['fangsong', 'STFangsong', 'STFangsong'],
  汉仪旗黑: ['sans'],
  方正黑体: ['sans', 'FZHei-B01S'],
  江西拙楷: ['kai'],
  方正粗金陵: ['display'],
  方正粗宋: ['serif'],
  庞门正道标题体: ['display'],
  '字魂36号-正文宋楷': ['serif'],
  时尚中黑: ['sans'],
  方正汉真广标: ['display'],
  圆体: ['round', 'STYuanti-SC-Regular', 'Yuanti SC'],
  仓耳渔阳体: ['round'],
  方正舒体: ['script', 'FZShuTi', 'FZShuTi'],
  汉仪综艺体: ['display'],
  文悦新青年体: ['display'],
  张海山锐线体: ['display'],
  '站酷小薇 LOGO 体': ['display'],
  汉仪颜楷: ['kai'],
  方正粗倩: ['display'],
  '字魂35号-经典雅黑': ['sans'],
  锐字锐线怒放黑: ['display'],
  字酷堂清楷体: ['kai'],
  汉仪铸字卡酷体: ['display'],
  '字魂148号-正酷魔方体': ['display'],
  方正苏新诗柳楷: ['kai'],
  梦源黑体: ['sans'],
  方正风雅宋: ['serif'],
  汉仪铸字美心体: ['display'],
  华康俪金黑: ['display'],
  方正公文黑体: ['sans'],
  汉仪刚艺体: ['display'],
  方正美黑: ['display'],
  汉仪书魂体: ['script'],
  汉仪君黑: ['sans'],
  方正北魏楷书: ['kai', undefined, 'Weibei SC'],
  汉仪小麦体: ['display'],
  汉仪中宋: ['serif'],
  华文彩云: ['display', 'STCaiyun', 'STCaiyun'],
  hakuyoxingshu7000: ['script'],
  汉仪大宋: ['serif'],
  创艺简标宋: ['serif'],
  'Aa 厚底黑': ['display'],
  三极拙楷: ['kai'],
  字制区喜脉体: ['display'],
  钉钉进步体: ['display', 'DingTalk-JinBuTi', 'DingTalk JinBuTi'],
  站酷文艺体: ['script'],
  锐字逼格青春粗黑体: ['display'],
  站酷快乐体: ['display', 'HappyZcool-2016', 'zcool-gdh'],
  站酷庆科黄油体: ['display'],
  // Other scripts
  'Segoe UI': ['sans', 'SegoeUI'], Calibri: ['sans', 'Calibri'], Arial: ['sans', 'ArialMT'], Impact: ['display', 'Impact'],
  'Times New Roman': ['serif', 'TimesNewRomanPSMT'], 'Century Gothic': ['sans', 'CenturyGothic'], 'Arial Black': ['display', 'Arial-Black'],
  Helvetica: ['sans', 'Helvetica'], Montserrat: ['sans', 'Montserrat-Regular'], 'Agency FB': ['display', 'AgencyFB-Reg'],
  'Helvetica Neue': ['sans', 'HelveticaNeue'], Poppins: ['sans', 'Poppins-Regular'], Verdana: ['sans', 'Verdana'], Bahnschrift: ['sans', 'Bahnschrift'],
  'Open Sans': ['sans', 'OpenSans-Regular'], Roboto: ['sans', 'Roboto-Regular'], Broadway: ['display', 'Broadway'], Tahoma: ['sans', 'Tahoma'],
  'Segoe Print': ['script', 'SegoePrint'], 'Trebuchet MS': ['sans', 'TrebuchetMS'], Lato: ['sans', 'Lato-Regular'], Cambria: ['serif', 'Cambria'],
  'Franklin Gothic': ['sans', 'FranklinGothic-Medium'], Britannic: ['display', 'BritannicBold'], 'Courier New': ['mono', 'CourierNewPSMT'],
  'Playfair Display': ['serif', 'PlayfairDisplay-Regular'], 'Source Sans Pro': ['sans', 'SourceSansPro-Regular'], Bauhaus: ['display', 'Bauhaus93'],
  'Palatino Linotype': ['serif', 'PalatinoLinotype-Roman', 'Palatino'], 'Comic Sans MS': ['script', 'ComicSansMS'], Abadi: ['sans', 'AbadiMT'],
  Abrasion: ['display'], Acuity: ['sans'], 'Adobe Caslon Pro': ['serif', 'ACaslonPro-Regular'], 'Alex Brush': ['script', 'AlexBrush-Regular'],
  Altitude: ['display'], 'Amigate Endgame': ['display'], Amiri: ['serif', 'Amiri-Regular'], Analogue: ['display'], Anton: ['display', 'Anton-Regular'],
  'Arial Narrow': ['sans', 'ArialNarrow'], Arimo: ['sans', 'Arimo-Regular', 'Arial'], 'Arno Pro': ['serif', 'ArnoPro-Regular'], Aulveth: ['display'],
  'Avenir Next': ['sans', 'AvenirNext-Regular'], Bangers: ['display', 'Bangers-Regular'], Barlow: ['sans', 'Barlow-Regular'],
  'Barlow Condensed': ['sans', 'BarlowCondensed-Regular'], Barrio: ['display', 'Barrio-Regular'], 'Bebas Neue': ['display', 'BebasNeue-Regular'],
  'Bell MT': ['serif', 'BellMT'], Bellota: ['display', 'Bellota-Regular'], 'Berlin Sans FB': ['display', 'BerlinSansFB-Reg'], Bevan: ['display', 'Bevan-Regular'],
  Blocks: ['display'], 'Bodoni Moda': ['serif', 'BodoniModa-Regular', 'Bodoni 72', 'Didot'], 'Bona Nova': ['serif', 'BonaNova-Regular'],
  'Cal Sans': ['sans', 'CalSans-SemiBold'], 'CoFo Sona': ['sans'], Comfortaa: ['round', 'Comfortaa-Regular'], 'Core Sans D': ['sans'],
  'Corporate Logo Rounded': ['round'], Cutin: ['display'], 'D-DIN Condensed': ['sans', 'D-DINCondensed'], 'Dela Gothic': ['display', 'DelaGothicOne-Regular'],
  'Do Hyeon': ['sans', 'DoHyeon-Regular'], 'Druk Wide': ['display', 'DrukWide-Bold'], 'Engravers Gothic': ['display'], Ethnocentric: ['display'],
  Fredoka: ['round', 'Fredoka-Regular'], Frick: ['display'], 'Funny & Cute': ['display'], Futura: ['sans', 'Futura-Medium'], Georgia: ['serif', 'Georgia'],
  Gotham: ['sans', 'Gotham-Book'], 'Great Vibes': ['script', 'GreatVibes-Regular'], Grenze: ['serif', 'Grenze-Regular'], 'HTF Didot': ['serif', undefined, 'Didot'],
  'ITC Kabel': ['sans'], Indivisible: ['sans'], Italianno: ['script', 'Italianno-Regular'], 'Josefin Sans': ['sans', 'JosefinSans-Regular'],
  Kanit: ['sans', 'Kanit-Regular'], 'Kaushan Script': ['script', 'KaushanScript-Regular'], Larken: ['serif'], Lateef: ['serif'], Lindqvist: ['display'],
  Lucette: ['display'], 'MADE Awelier': ['display'], 'Malgun Gothic': ['sans', 'MalgunGothic'], Mali: ['script', 'Mali-Regular'], Menlo: ['mono', 'Menlo-Regular'],
  Merriweather: ['serif', 'Merriweather-Regular'], 'Microsoft Sans Serif': ['sans', 'MicrosoftSansSerif'], 'Midlenorth Constane': ['display'],
  'Nanum Gothic': ['sans', 'NanumGothic'], 'New Terror': ['display'], 'Noto Sans': ['sans', 'NotoSans-Regular'], 'Noto Serif JP': ['serif', 'NotoSerifJP-Regular'],
  Oswald: ['sans', 'Oswald-Regular'], 'PT Serif Caption': ['serif', 'PTSerif-Caption'], 'Proxima Nova': ['sans', 'ProximaNova-Regular'],
  'Public Sans': ['sans', 'PublicSans-Regular'], Raleway: ['sans', 'Raleway-Regular'], Right: ['sans'], RoundedBlock: ['round'], Rubik: ['sans', 'Rubik-Regular'],
  SchoolBook: ['serif', undefined, 'Century Schoolbook'], 'Sequel 100 Wide': ['display'], Shadow: ['display'], SpeedLines: ['display'], Spire: ['display'],
  'Story Script': ['script', 'StoryScript-Regular'], SymphonyPro: ['script'], 'TikTok Sans': ['sans', 'TikTokSans-Regular'], 'Tw Cen MT': ['sans', 'TwCenMT-Regular'],
  ZYIDAFLIPPED: ['display'], ZYIDAGNOMESHGH: ['display'], ZYIDAMIRAITOWA: ['display'], ZYRUAATARAXIA: ['script'], ZYRUAPETRICHOR: ['script'],
  ZyaeaMeteor: ['display'], ZylaaDeepblue: ['display'], ZyruaAmireux: ['script'], ZyruaPalpitate: ['script'], ZyruaRedamancy: ['script'], ZyruaSonorous: ['script'],
}
/** Closest common fonts per category; the generic keyword closes each chain. */
const FALLBACK: Record<FontCategory, { cjk: string[]; latin: string[]; generic: string; ps: { cjk: string; latin: string } }> = {
  sans: { cjk: ['PingFang SC', 'Source Han Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei'], latin: ['Helvetica Neue', 'Arial'], generic: 'sans-serif', ps: { cjk: 'PingFangSC-Regular', latin: 'ArialMT' } },
  serif: { cjk: ['Songti SC', 'Source Han Serif SC', 'Noto Serif CJK SC', 'SimSun'], latin: ['Georgia', 'Times New Roman'], generic: 'serif', ps: { cjk: 'STSongti-SC-Regular', latin: 'TimesNewRomanPSMT' } },
  kai: { cjk: ['Kaiti SC', 'STKaiti', 'KaiTi'], latin: ['Georgia'], generic: 'serif', ps: { cjk: 'STKaitiSC-Regular', latin: 'Georgia' } },
  fangsong: { cjk: ['STFangsong', 'FangSong'], latin: ['Georgia'], generic: 'serif', ps: { cjk: 'STFangsong', latin: 'Georgia' } },
  round: { cjk: ['Yuanti SC', 'YouYuan', 'PingFang SC'], latin: ['Arial Rounded MT Bold', 'Helvetica Neue'], generic: 'sans-serif', ps: { cjk: 'STYuanti-SC-Regular', latin: 'ArialRoundedMTBold' } },
  display: { cjk: ['PingFang SC', 'Microsoft YaHei'], latin: ['Impact', 'Arial Black'], generic: 'sans-serif', ps: { cjk: 'PingFangSC-Semibold', latin: 'Impact' } },
  script: { cjk: ['Xingkai SC', 'STXingkai', 'Kaiti SC'], latin: ['Snell Roundhand', 'Brush Script MT'], generic: 'cursive', ps: { cjk: 'STXingkaiSC-Light', latin: 'SnellRoundhand' } },
  mono: { cjk: ['PingFang SC'], latin: ['Menlo', 'Courier New'], generic: 'monospace', ps: { cjk: 'PingFangSC-Regular', latin: 'Menlo-Regular' } },
}
const byLower = new Map(Object.keys(F).map(name => [name.toLowerCase().replace(/\s+/g, ' '), name]))
/** Exact name as listed, tolerant of case and spacing; undefined for unlisted names. */
export function ocrFont(name: string): { name: string; category: FontCategory; postscript?: string; families: string[] } | undefined {
  const key = byLower.get(name.trim().toLowerCase().replace(/\s+/g, ' ')), entry = key ? F[key] : undefined
  if (!key || !entry) return undefined
  const [category, postscript, ...extra] = entry
  return { name: key, category, ...(postscript ? { postscript } : {}), families: [...new Set([key, ...extra])] }
}
const cjkName = /[\p{Script=Han}]/u
/** A CSS font-family list: the named font, its known aliases, then the closest category fallbacks. */
export function fontStack(name: string): string {
  const hit = ocrFont(name), category = hit?.category ?? (cjkName.test(name) ? 'sans' : 'sans'), fallback = FALLBACK[category]
  const own = hit?.families ?? [name.trim() || 'Arial']
  const chain = [...new Set([...own, ...fallback.latin, ...fallback.cjk])]
  return [...chain.map(f => `"${f.replace(/["\\]/g, '')}"`), fallback.generic].join(', ')
}
/** PostScript name for PSD text. Unlisted or unmapped fonts fall back by category and script. */
export function fontPostScript(name: string, cjkText: boolean): string | undefined {
  const hit = ocrFont(name)
  if (!hit) return undefined
  const cjkFont = cjkName.test(hit.name) || ['Arial Unicode MS', 'HarmonyOS Sans', 'MiSans', 'OPPOSans'].includes(hit.name)
  if (hit.postscript && (cjkFont || !cjkText)) return hit.postscript
  return FALLBACK[hit.category].ps[cjkText ? 'cjk' : 'latin']
}
export const OCR_FONT_COUNT = Object.keys(F).length
