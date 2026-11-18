import { useEffect, useRef, useState } from 'react'
import type { CanvasItem, Composition } from '../shared/types.js'
import { labelOf } from '../shared/types.js'
import { RESEARCH_TOOLS } from '../shared/research.js'
import type { ResearchToolId } from '../shared/research.js'
import type { CanvasModel } from './controller.js'
import { imageUrl } from './controller.js'
import { ImageIcon, NewIcon, SparkIcon, TextIcon } from './icons.js'
import { ResearchDialog } from './ResearchDialog.js'

function ToolGlyph({ tool }: { tool: ResearchToolId }) {
  if (tool === 'text') return <TextIcon size={22}/>
  if (tool === 'generate') return <SparkIcon size={22}/>
  if (tool === 'reference' || tool === 'sketch') return <ImageIcon size={22}/>
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tool === 'decompose' ? <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></> : <><rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="2 3"/><path d="M7 16c1-6 2-9 5-9s4 3 5 9H7Z"/><path d="m3 21 18-18"/></>}
  </svg>
}
export function ResearchTools({ onSelect, compact = false, disabled = false }: { onSelect(tool: ResearchToolId): void; compact?: boolean; disabled?: boolean }) {
  return <div className="sd-research-tools" data-compact={compact}>{RESEARCH_TOOLS.map(tool => <button type="button" className="sd-research-tool" key={tool.id} disabled={disabled} aria-label={tool.title} title={compact ? tool.description : undefined} onClick={() => onSelect(tool.id)}>
    <span className="sd-tool-glyph" data-tool={tool.id}><ToolGlyph tool={tool.id}/></span><span><strong>{tool.title}</strong><small>{tool.description}</small></span><span className="sd-tool-arrow" aria-hidden="true">↗</span>
  </button>)}</div>
}

export async function readImportFile(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('请选择 PNG 或 JPEG 图片。')
  if (!file.size || file.size > 30 * 1024 * 1024) throw new Error('请选择不超过 30 MB 的图片。')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败。'))
    reader.readAsDataURL(file)
  })
}

export function ResearchSourcePicker({ tool, model, items, compositions, onSelect, onOpenComposition, onClose }: {
  tool: Exclude<ResearchToolId, 'generate'> | 'import'; model: CanvasModel; items: CanvasItem[]; compositions: Composition[]
  onSelect(item: CanvasItem): void | Promise<void>; onOpenComposition(id: string): void; onClose(): void
}) {
  const info = RESEARCH_TOOLS.find(t => t.id === tool), input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), running = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const importFile = async (file: File) => {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try {
      const image = await readImportFile(file)
      if (!alive.current) return
      const item = await model.importImage(image, file.name.replace(/\.[^.]+$/, '') || '导入图片')
      if (alive.current) await onSelect(item)
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '导入失败') }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }
  return <ResearchDialog title={info?.title ?? '导入图片'} onClose={onClose}>
    <p className="sd-research-lede">{info?.hint ?? '把图片保存到当前画布，继续分层、编辑或用作参考。'}</p>
    <div className="sd-import-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const files = e.dataTransfer.files; if (files.length !== 1) setError('请一次导入一张图片。'); else if (files[0]) void importFile(files[0]) }}>
      <button type="button" className="sd-button" disabled={busy} onClick={() => input.current?.click()}><NewIcon size={16}/>{busy ? '正在导入…' : '选择本地图片'}</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden aria-label="导入 PNG 或 JPEG" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file) }}/>
      <span>也可拖入 PNG / JPEG · 最多 30 MB</span><small>导入本身不调用模型</small>
    </div>
    {error ? <p className="sd-research-error" role="alert">{error}</p> : null}
    {tool === 'text' && compositions.length ? <section className="sd-source-section"><h3>继续编辑图层画板</h3><div className="sd-source-list">{compositions.map(c => <button type="button" key={c.id} disabled={busy} onClick={() => onOpenComposition(c.id)}><TextIcon/><span><strong>{c.title}</strong><small>{c.layers.length} 个图层 · 本地编辑</small></span></button>)}</div></section> : null}
    {tool !== 'import' && items.length ? <section className="sd-source-section"><h3>选择当前画布的图片</h3><div className="sd-source-list">{items.map(item => <button type="button" key={item.id} disabled={busy} onClick={() => { void onSelect(item) }}><img src={imageUrl(model.sessionId, item.id)} alt="" loading="lazy"/><span><strong>{labelOf(item)}</strong><small>{item.width} × {item.height}</small></span></button>)}</div></section> : null}
  </ResearchDialog>
}
