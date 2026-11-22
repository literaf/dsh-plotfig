import { useRef, useState } from 'react'
import { createDiagramTemplate, DIAGRAM_PALETTES, DIAGRAM_TEMPLATES, TEMPLATE_CATEGORIES } from '../shared/templates.js'
import type { DiagramPalette, TemplateId } from '../shared/templates.js'
import { diagramSvg } from '../shared/diagram-svg.js'
import { ResearchDialog } from './ResearchDialog.js'
import { ChevronIcon, ShapesIcon } from './icons.js'

const pickerTemplates = DIAGRAM_TEMPLATES.filter(template => template.category !== '流程图')
const pickerCategories = TEMPLATE_CATEGORIES.filter(category =>
  category === '全部' || pickerTemplates.some(template => template.category === category))

export function TemplateButton({ onClick, disabled = false, open = false }: { onClick(): void; disabled?: boolean; open?: boolean }) {
  return <button type="button" className="sd-chip" onClick={onClick} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-label="选择图形模板"><ShapesIcon size={14}/>模板<ChevronIcon size={12}/></button>
}
export function DiagramTemplates({ onCreate, onClose }: { onCreate(id: TemplateId, palette: DiagramPalette): Promise<void>; onClose(): void }) {
  const [category, setCategory] = useState<typeof TEMPLATE_CATEGORIES[number]>('全部')
  const [template, setTemplate] = useState(pickerTemplates[0]!)
  const [palette, setPalette] = useState<DiagramPalette>('ocean')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const creating = useRef(false)
  function selectCategory(next: typeof category) {
    setCategory(next)
    if (next !== '全部' && template.category !== next) {
      setTemplate(pickerTemplates.find(t => t.category === next)!)
    }
  }
  const create = async () => {
    if (creating.current) return
    creating.current = true; setBusy(true); setError('')
    try { await onCreate(template.id, palette) } catch (e) { setError(e instanceof Error ? e.message : '创建模板失败，请重试。') } finally { creating.current = false; setBusy(false) }
  }
  return <ResearchDialog title="图形模板" wide onClose={() => { if (!busy) onClose() }}>
    <p className="sd-research-lede">选择布局，直接修改文字、节点和配色。创建与编辑在本地完成，无需生图。</p>
    <div className="sd-template-tabs" aria-label="模板分类">{pickerCategories.map(c => <button type="button" key={c} aria-pressed={category === c} disabled={busy} onClick={() => selectCategory(c)}>{c}</button>)}</div>
    <div className="sd-template-grid">{pickerTemplates.filter(t => category === '全部' || category === t.category).map(t => <button type="button" className="sd-template-card" key={t.id} aria-pressed={template.id === t.id} disabled={busy} onClick={() => setTemplate(t)}>
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagramSvg(createDiagramTemplate(t.id, palette)))}`} alt={`${t.name}预览`}/>
      <strong>{t.name}</strong><span>{t.detail}</span>
    </button>)}</div>
    <div className="sd-template-footer"><div className="sd-template-palettes" aria-label="模板配色">{DIAGRAM_PALETTES.map(p => <button type="button" key={p.id} aria-pressed={p.id === palette} disabled={busy} onClick={() => setPalette(p.id)}><i style={{ background: p.stroke }}/>{p.name}</button>)}</div>
      <button type="button" className="sd-button sd-button-primary" disabled={busy} onClick={() => { void create() }}>{busy ? '创建中…' : `使用「${template.name}」`}</button>
    </div>
    {error ? <p className="sd-research-error" role="alert">{error}</p> : null}
    <p className="sd-research-note">内容为可替换的示例。拖动节点后，连线会自动更新；支持 PNG、SVG 和分层 PSD 导出。</p>
  </ResearchDialog>
}
