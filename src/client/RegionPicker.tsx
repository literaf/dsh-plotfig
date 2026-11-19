import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { PixelBox } from '../shared/regions.js'
import { MAX_REGIONS } from '../shared/regions.js'

/**
 * Drag rectangles on an image preview. Boxes are kept in source pixels; the parent
 * converts them to Ark `<bbox>` tags. Numbered labels let prompts refer to 区域 1, 2…
 */
export function RegionPicker({ src, width, height, value, onChange, maxHeight = 320, label = '框选区域' }: {
  src: string; width: number; height: number; value: PixelBox[]; onChange(v: PixelBox[]): void; maxHeight?: number; label?: string
}) {
  const host = useRef<HTMLDivElement>(null), [box, setBox] = useState({ w: 0, h: 0 }), [draft, setDraft] = useState<PixelBox>(), start = useRef<{ x: number; y: number }>()
  useLayoutEffect(() => {
    const element = host.current; if (!element) return
    const resize = () => { const w = element.clientWidth, scale = Math.min(w / width, maxHeight / height); setBox({ w: width * scale, h: height * scale }) }
    const observer = new ResizeObserver(resize); resize(); observer.observe(element); return () => observer.disconnect()
  }, [width, height, maxHeight])
  useEffect(() => { if (!value.length) setDraft(undefined) }, [value])
  const scale = box.w / width || 1
  const point = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: Math.max(0, Math.min(width, (e.clientX - r.left) / scale)), y: Math.max(0, Math.min(height, (e.clientY - r.top) / scale)) }
  }
  const down = (e: PointerEvent) => {
    if (value.length >= MAX_REGIONS) return
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); start.current = point(e); setDraft({ ...start.current, width: 0, height: 0 })
  }
  const move = (e: PointerEvent) => {
    const s = start.current; if (!s) return
    const p = point(e); setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) })
  }
  const up = () => {
    const d = draft; start.current = undefined; setDraft(undefined)
    if (d && d.width * scale >= 6 && d.height * scale >= 6) onChange([...value, { x: Math.round(d.x), y: Math.round(d.y), width: Math.round(d.width), height: Math.round(d.height) }])
  }
  const shown = draft ? [...value, draft] : value
  return <div className="sd-region-picker" ref={host}>
    <div className="sd-region-stage" style={{ width: box.w, height: box.h }} role="application" aria-label={label} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <img src={src} alt="" draggable={false}/>
      {shown.map((b, i) => <span key={i} className="sd-region-box" style={{ left: b.x * scale, top: b.y * scale, width: b.width * scale, height: b.height * scale }}><b>{i + 1}</b></span>)}
    </div>
    <div className="sd-region-actions">
      <span>{value.length ? `已框选 ${value.length} 个区域` : '在图上拖动框选，可选多个'}</span>
      <button type="button" disabled={!value.length} onClick={() => onChange(value.slice(0, -1))}>撤销</button>
      <button type="button" disabled={!value.length} onClick={() => onChange([])}>清空</button>
    </div>
  </div>
}
