import { useId } from 'react'
import { RESEARCH_STYLES, styleName } from '../shared/research.js'
import type { GenerationStyle, ResearchStyleId } from '../shared/research.js'
import { ResearchDialog } from './ResearchDialog.js'
import { CheckIcon, ChevronIcon } from './icons.js'

export function ResearchStyleButton({ value, busy = false, open = false, onClick }: { value: GenerationStyle; busy?: boolean; open?: boolean; onClick(): void }) {
  return <button type="button" className="sd-chip sd-current-style" disabled={busy} onClick={onClick} aria-haspopup="dialog" aria-expanded={open} aria-label="选择生图风格" title={`生图风格：${styleName(value)}`}>
    <span className="sd-style-dot"/>{busy ? '保存风格…' : value === 'auto' ? '风格' : styleName(value)}<ChevronIcon size={12}/>
  </button>
}

/** Original vector swatches: the same abstract signal/cell/response scene in six visual treatments. */
export function StylePreview({ style }: { style: ResearchStyleId }) {
  const unique = useId().replace(/:/g, ''), gradient = `sd-cell-${unique}`, shade = `sd-shade-${unique}`
  const line = style === 'line-art', hand = style === 'hand-drawn', journal = style === 'journal', depth = style === '2.5d' || style === '3d', solid = style === '3d'
  const ink = line ? '#293338' : journal ? '#36596a' : hand ? '#695f51' : '#497c82'
  const blue = line ? '#fff' : hand ? '#c3d9cd' : journal ? '#e5f1f2' : '#c1e2e3'
  return <svg className="sd-style-preview" viewBox="0 0 280 150" role="img" aria-label={`${styleName(style)}风格示意`}>
    <defs>
      <radialGradient id={gradient} cx="30%" cy="24%" r="78%"><stop stopColor="#f4ffff"/><stop offset=".5" stopColor="#a8dbdc"/><stop offset="1" stopColor="#41818c"/></radialGradient>
      <radialGradient id={shade}><stop stopColor="#688080" stopOpacity=".22"/><stop offset="1" stopColor="#688080" stopOpacity="0"/></radialGradient>
    </defs>
    <rect width="280" height="150" rx="12" fill={hand ? '#f9f6ee' : '#fbfcfb'}/>
    {hand ? Array.from({ length: 9 }, (_, i) => <path key={i} d={`M0 ${12 + i * 17} L280 ${8 + i * 17}`} stroke="#938771" opacity=".045"/>) : null}
    {depth ? <ellipse cx="138" cy="122" rx="58" ry="13" fill={`url(#${shade})`}/> : null}
    <g stroke={ink} strokeWidth={journal ? 1.3 : hand ? 1.9 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d={hand ? 'M85 71C84 45 109 29 136 29C166 29 188 48 188 77C188 106 164 121 135 119C107 119 84 100 85 71Z' : 'M85 75C85 46 107 28 137 28C166 28 188 47 188 76C188 104 166 121 136 121C107 121 85 103 85 75Z'} fill={solid ? `url(#${gradient})` : blue}/>
      <path d="M92 75C92 50 111 35 137 35C161 35 181 50 181 76C181 100 162 114 136 114C110 114 92 99 92 75Z" fill="none" opacity={line ? .6 : .35}/>
      <ellipse cx="141" cy="73" rx={journal ? 18 : 23} ry="20" fill={line ? '#fff' : solid ? '#698faf' : '#a7c3d9'}/>
      <ellipse cx="145" cy="72" rx="7" ry="6" fill={line ? '#293338' : '#6489a0'} stroke="none"/>
      <path d="M106 91c-9-7-15 0-10 7 6 10 21 4 16-2m-11-3 7 6" fill={line ? '#fff' : '#ecd6b4'} stroke={line ? ink : '#b39770'}/>
      <path d="M160 46c10-6 17 1 13 8-5 8-18 4-15-3m5-2 6 3" fill={line ? '#fff' : '#ecd6b4'} stroke={line ? ink : '#b39770'}/>
      <path d="M31 74h43m-8-5 8 5-8 5M198 74h30m-8-5 8 5-8 5" fill="none"/>
      <circle cx="27" cy="74" r="8" fill={line ? '#fff' : '#deb69d'}/>
      <circle cx="39" cy="50" r="4" fill={line ? '#fff' : '#deb69d'} opacity=".7"/>
      <circle cx="38" cy="98" r="4" fill={line ? '#fff' : '#deb69d'} opacity=".7"/>
      <path d="M236 95V56m0 39h29" fill="none"/>
      <path d="M241 87v-9h4v9m5 0V68h4v19m5 0V58h4v29" fill={line ? '#fff' : '#91bcb2'} strokeWidth="1.2"/>
      {line ? <path d="m100 44 7-7m-13 18 17-17m57 62 9-9m-19 17 15-15" opacity=".5"/> : null}
      {solid ? <path d="M104 45c10-9 20-10 29-10" stroke="#fff" strokeWidth="5" opacity=".5"/> : null}
    </g>
    <g fill={ink} fontFamily="Arial, sans-serif" fontSize="8" letterSpacing={journal ? '1' : '.2'}>
      <text x="15" y="130">SIGNAL</text><text x="124" y="140">CELL</text><text x="223" y="113">RESPONSE</text>
    </g>
  </svg>
}

export function StyleChoices({ value, onPick, disabled = false }: { value?: GenerationStyle; onPick(style: ResearchStyleId): void; disabled?: boolean }) {
  return <div className="sd-style-grid">{RESEARCH_STYLES.map(style => <button type="button" className="sd-style-card" key={style.id} aria-pressed={value === style.id} disabled={disabled} onClick={() => onPick(style.id)}>
    <StylePreview style={style.id}/><span className="sd-style-caption"><strong>{style.name}</strong>{value === style.id ? <CheckIcon size={14}/> : null}</span>
    <span className="sd-style-detail">{style.detail}</span><span className="sd-style-use">{style.use}</span>
  </button>)}</div>
}

export function ResearchStylePicker({ value, busy, error, onPick, onClose, newCanvas = false }: { value: GenerationStyle; busy: boolean; error?: string | undefined; onPick(style: GenerationStyle): void; onClose(): void; newCanvas?: boolean }) {
  return <ResearchDialog title="科研插图风格" wide onClose={onClose}>
    <p className="sd-research-lede">{newCanvas ? '为新图片选择视觉风格，填写描述后再生成。' : '为这张画布的后续生图选择视觉风格。选择不会生成图片，也不会修改已有作品。'}</p>
    {error ? <p className="sd-research-error" role="alert">{error}</p> : null}
    <button type="button" className="sd-style-auto" disabled={busy} aria-pressed={value === 'auto'} onClick={() => onPick('auto')}><span><strong>跟随描述</strong><small>根据你的提示词决定风格</small></span>{value === 'auto' ? <CheckIcon size={16}/> : null}</button>
    <StyleChoices value={value} onPick={onPick} disabled={busy}/>
    <p className="sd-research-note">同一主题的风格示意，实际生成效果随内容变化。风格预设不代表期刊投稿规范。</p>
  </ResearchDialog>
}
