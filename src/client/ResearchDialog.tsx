import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { CloseIcon } from './icons.js'

export function ResearchDialog({ title, onClose, children, wide = false }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const root = useRef<HTMLDivElement>(null), titleId = useId()
  useEffect(() => {
    const dialog = root.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    dialog?.focus()
    return () => {
      // A tool may have moved focus to the canvas prompt or the host's chat input.
      const active = document.activeElement
      if (previous?.isConnected && (active === document.body || dialog?.contains(active))) previous.focus()
    }
  }, [])
  return <div className="sd-research-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={root} className="sd-research-dialog" data-wide={wide} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={e => {
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key !== 'Tab') return
      const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? []).filter(el => !el.hidden)
      const first = controls[0], last = controls.at(-1)
      if (!first) { e.preventDefault(); return }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }}>
      <header><strong id={titleId}>{title}</strong><button className="sd-icon-button" type="button" aria-label={`关闭${title}`} onClick={onClose}><CloseIcon/></button></header>
      <div className="sd-research-dialog-body">{children}</div>
    </div>
  </div>
}
