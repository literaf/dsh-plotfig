import { RESEARCH_STYLES, styleName } from '../shared/research.js'
import type { GenerationStyle, ResearchStyleId } from '../shared/research.js'
import { STYLE_PREVIEWS } from './style-previews.js'
import { ResearchDialog } from './ResearchDialog.js'
import { CheckIcon, ChevronIcon } from './icons.js'

export function ResearchStyleButton({ value, busy = false, open = false, onClick }: { value: GenerationStyle; busy?: boolean; open?: boolean; onClick(): void }) {
  return <button type="button" className="sd-chip sd-current-style" disabled={busy} onClick={onClick} aria-haspopup="dialog" aria-expanded={open} aria-label="选择生图风格" title={`生图风格：${styleName(value)}`}>
    <span className="sd-style-dot"/>{busy ? '保存风格…' : value === 'auto' ? '风格' : styleName(value)}<ChevronIcon size={12}/>
  </button>
}

/** Cross-disciplinary representative reference; appearance preview only, not a scientific content guarantee. */
export function StylePreview({ style }: { style: ResearchStyleId }) {
  return <img className="sd-style-preview" src={STYLE_PREVIEWS[style]} alt={`${styleName(style)}：跨学科代表样图`} width="420" height="280"/>
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
    {value === 'journal' ? <p className="sd-research-note">当前保留简洁期刊旧预设；选择下方画法后更新，已有图片不变。</p> : null}
    <StyleChoices value={value} onPick={onPick} disabled={busy}/>
    <p className="sd-research-note">跨学科代表样图用于说明画法适配的科研表达；受控同主题显微镜对照保留在离线风格库中。实际效果随内容变化，学科、图型与配色可在描述中独立指定。</p>
  </ResearchDialog>
}
