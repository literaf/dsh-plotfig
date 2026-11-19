import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RATIOS, SIZE_TIERS } from '../shared/types.js'
import { CheckIcon, ChevronIcon, CloseIcon, SendIcon, StopIcon } from './icons.js'

/** '' means the default size from settings; otherwise a tier or one of RATIOS' WxH. */
export type SizeChoice = string
export function sizeLabel(size: SizeChoice, fallback?: string): string {
  if (!size) return fallback || '尺寸'
  return RATIOS.find(r => r.size === size)?.id ?? size
}
/** Rectangle preview for a ratio chip, scaled into a 16px box. */
function RatioGlyph({ size }: { size: string }) {
  const [w, h] = size.includes('x') ? size.split('x').map(Number) as [number, number] : [1, 1]
  const k = 14 / Math.max(w, h)
  return <span className="sd-ratio-glyph"><span style={{ width: Math.max(4, w * k), height: Math.max(4, h * k) }}/></span>
}
function useOutside(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', down, true); document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true) }
  }, [open, close, ref])
}
export function SizePicker({ value, onChange, fallback }: { value: SizeChoice; onChange(v: SizeChoice): void; fallback?: string | undefined }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null)
  useOutside(open, () => setOpen(false), root)
  // Focus goes back to the prompt so Enter submits right after choosing.
  const pick = (v: SizeChoice) => { onChange(v); setOpen(false); root.current?.closest('.sd-composer')?.querySelector('textarea')?.focus() }
  return <div className="sd-size" ref={root}>
    <button type="button" className="sd-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="尺寸与比例" aria-label={`尺寸与比例：${value ? sizeLabel(value) : `默认${fallback ? ` ${fallback}` : ''}`}`}>
      <RatioGlyph size={value || '1x1'}/>{sizeLabel(value, fallback)}<ChevronIcon size={12}/>
    </button>
    {open ? <div className="sd-menu" role="menu">
      <div className="sd-menu-head">比例 · 2K</div>
      <div className="sd-ratio-grid">{RATIOS.map(r => <button type="button" role="menuitemradio" aria-checked={value === r.size} key={r.id} className="sd-ratio" onClick={() => pick(r.size)}>
        <RatioGlyph size={r.size}/><span>{r.id}</span></button>)}</div>
      <div className="sd-menu-head">清晰度 · 比例由模型决定</div>
      {(['', ...SIZE_TIERS] as string[]).map(t => <button type="button" role="menuitemradio" aria-checked={value === t} key={t || 'default'} className="sd-menu-item" onClick={() => pick(t)}>
        <span>{t ? t : `默认${fallback ? `（${fallback}）` : ''}`}</span>{value === t ? <CheckIcon size={14}/> : null}</button>)}
    </div> : null}
  </div>
}
/** Transparent-background output, a toggle beside the size picker. */
export function TransparentToggle({ value, onChange }: { value: boolean; onChange(v: boolean): void }) {
  return <button type="button" className="sd-chip sd-transparent-chip" aria-pressed={value} onClick={() => onChange(!value)} title="生成透明背景的 PNG，只保留主体，适合图标、器件和组图素材">
    <span className="sd-checker" aria-hidden="true"/>透明背景
  </button>
}
/**
 * The prompt box: grows with its text, submits on Enter (Shift+Enter for a new
 * line, IME composition respected), and turns its send button into a stop
 * button while this view waits on a request.
 */
export function Composer({ value, onChange, onSubmit, onStop, waiting, placeholder, autoFocus, children, context, onClearContext, hint, disabled }: {
  value: string; onChange(v: string): void; onSubmit(): void; onStop?: (() => void) | undefined
  waiting?: boolean; placeholder: string; autoFocus?: boolean; children?: ReactNode
  /** A chip above the text naming what the prompt applies to (e.g. the image being edited). */
  context?: ReactNode; onClearContext?: (() => void) | undefined; hint?: string
  disabled?: boolean | undefined
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])
  useEffect(() => { if (autoFocus) area.current?.focus() }, [autoFocus])
  const ready = !disabled && value.trim().length > 0
  return <div className="sd-composer-shell"><form className="sd-composer" data-focus-within onSubmit={e => { e.preventDefault(); if (ready) onSubmit() }}>
    {context ? <div className="sd-composer-context">{context}{onClearContext ? <button type="button" className="sd-icon-button sd-icon-small" onClick={onClearContext} aria-label="取消"><CloseIcon size={12}/></button> : null}</div> : null}
    <textarea ref={area} rows={2} aria-label="图片描述" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (ready) onSubmit() } }}/>
    <div className="sd-composer-bar">
      <div className="sd-composer-tools">{children}</div>
      <div className="sd-composer-submit"><span className="sd-composer-model" title="当前绘图模型">Seedream 5.5</span>
      {waiting && onStop && !ready
        ? <button type="button" className="sd-send sd-send-stop" onClick={onStop} title="停止等待（已发出的请求仍可能计费）" aria-label="停止等待"><StopIcon size={14}/></button>
        : <button type="submit" className="sd-send" disabled={!ready} title="生成（Enter）" aria-label="生成"><SendIcon size={16}/></button>}
      </div>
    </div>
  </form><div className="sd-composer-footer">
    {hint ? <span className="sd-composer-hint">{hint}</span> : null}
    <span className="sd-composer-keyboard">Enter 生成 · Shift + Enter 换行</span>
  </div></div>
}
