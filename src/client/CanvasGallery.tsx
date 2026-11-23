import { useRef, useState } from 'react'
import { isBoard } from '../shared/types.js'
import type { CanvasEntry } from '../shared/types.js'
import { imageUrl } from './controller.js'
import type { Catalog, Controller } from './controller.js'
import { ChevronIcon, ImageIcon, TrashIcon } from './icons.js'
import { ResearchDialog } from './ResearchDialog.js'

const RECENT_CANVASES = 8

function relative(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`
  return new Date(iso).toLocaleDateString()
}

function CardContents({ entry, running }: { entry: CanvasEntry; running: boolean }) {
  const { sessionId, cover, diagramCover, revision, title, count, updatedAt } = entry
  return <>
    <span className="sd-card-cover">
      {cover ? <img src={imageUrl(sessionId, cover)} alt="" loading="lazy"/>
        : diagramCover ? <img data-diagram src={`${imageUrl(sessionId, diagramCover)}&diagram=1&v=${revision}`} alt="" loading="lazy"/>
        : <ImageIcon size={22}/>}
      {running ? <span className="sd-card-badge"><span className="sd-spinner sd-spinner-small"/>生成中</span>
        : entry.hasPendingLayers ? <span className="sd-card-badge">分层待取回</span>
        : count > 1 ? <span className="sd-card-badge">{count} 张</span> : null}
    </span>
    <strong>{title}</strong>
    <span className="sd-card-meta">
      <span className="sd-tag" data-kind={isBoard(sessionId) ? 'board' : 'chat'}>{isBoard(sessionId) ? '独立' : '对话'}</span>
      {relative(updatedAt)}
    </span>
  </>
}

export function CanvasGallery({ controller, catalog, library, showAll, openCanvas }: {
  controller: Controller; catalog: Catalog | undefined; library: boolean; showAll(): void; openCanvas(id: string): void
}) {
  const [managing, setManaging] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<CanvasEntry[]>()
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [failures, setFailures] = useState<Array<{ entry: CanvasEntry; error: string }>>([])
  const canvases = catalog?.canvases ?? []
  const visible = library ? canvases : canvases.slice(0, RECENT_CANVASES)
  const blockedReason = (entry: CanvasEntry) => {
    if (catalog?.active?.[entry.sessionId]?.length) return '任务完成后可删除'
    if (entry.hasPendingLayers) return '请先在画布中处理待取回的分层结果'
    return ''
  }
  const eligible = canvases.filter(entry => !blockedReason(entry))
  const chosen = eligible.filter(entry => selected.has(entry.sessionId))
  const allSelected = eligible.length > 0 && chosen.length === eligible.length
  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function finish() {
    setManaging(false)
    setSelected(new Set())
    setFailures([])
  }
  async function remove() {
    if (!confirm?.length || submitting.current) return
    submitting.current = true
    setBusy(true)
    try {
      const failed = await controller.removeCanvases(confirm)
      setFailures(failed)
      setSelected(new Set(failed.map(({ entry }) => entry.sessionId)))
      if (!failed.length) setManaging(false)
      setConfirm(undefined)
    } finally { submitting.current = false; setBusy(false) }
  }
  return <>
    {!library && canvases.length > 0 && <div className="sd-recent-title">
      <h2>最近画布</h2>
      <button type="button" className="sd-all-canvases" onClick={showAll} aria-label="全部画布"><span>全部画布</span><span className="sd-canvas-count">{canvases.length}</span><ChevronIcon size={14}/></button>
    </div>}
    {library && canvases.length > 0 && <div className="sd-library-controls" role="group" aria-label="画布管理">
      {managing ? <>
        <label className="sd-select-all">
          <input type="checkbox" checked={allSelected} disabled={!eligible.length || busy}
            ref={el => { if (el) el.indeterminate = chosen.length > 0 && !allSelected }}
            onChange={() => setSelected(new Set(allSelected ? [] : eligible.map(entry => entry.sessionId)))}/> 全选
        </label>
        <span className="sd-selection-count" role="status">已选 {chosen.length} 个</span>
        <button type="button" className="sd-button" onClick={finish} disabled={busy}>退出管理</button>
        <button type="button" className="sd-button sd-delete-button" disabled={!chosen.length || busy} onClick={() => setConfirm(chosen)}>
          <TrashIcon size={14}/>删除所选
        </button>
      </> : <button type="button" className="sd-button" onClick={() => { setFailures([]); setManaging(true) }}>管理画布</button>}
    </div>}
    {failures.length > 0 && <div className="sd-alert" role="alert">
      {failures.map(({ entry, error }) => <div key={entry.sessionId}>「{entry.title}」{error}</div>)}
    </div>}
    {canvases.length ? <ul className="sd-gallery" aria-label={library ? '全部画布' : '最近画布'} data-view={library ? 'all' : 'recent'}>
      {visible.map(entry => {
        const id = entry.sessionId, reason = blockedReason(entry)
        const contents = <CardContents entry={entry} running={!!catalog?.active?.[id]?.length}/>
        return <li key={id}>
          {managing ? <label className="sd-card sd-select-card" data-selected={!reason && selected.has(id)} data-blocked={!!reason} title={reason || undefined}>
            <input className="sd-card-check" type="checkbox" aria-label={`选择画布「${entry.title}」`} checked={!reason && selected.has(id)} disabled={!!reason || busy} onChange={() => toggle(id)}/>
            {contents}
          </label> : <>
            <button type="button" className="sd-card" onClick={() => openCanvas(id)}>{contents}</button>
            <button type="button" className="sd-icon-button sd-card-delete" aria-label={`删除画布「${entry.title}」`} title={reason || '删除画布'} disabled={!!reason}
              onClick={() => { setFailures([]); setConfirm([entry]) }}><TrashIcon size={15}/></button>
          </>}
        </li>
      })}
    </ul> : <div className="sd-home-empty">{library ? '还没有画布。' : '还没有画布。在上方输入描述，开始第一张图。'}</div>}
    {confirm && <ResearchDialog title="删除画布" onClose={() => { if (!submitting.current) setConfirm(undefined) }}>
      <div className="sd-delete-confirm" aria-busy={busy}>
        <p>{confirm.length === 1 ? `确定删除「${confirm[0]!.title}」？` : `确定删除选中的 ${confirm.length} 个画布？`}</p>
        {confirm.length > 1 && <ul>{confirm.map(entry => <li key={entry.sessionId}>{entry.title}</li>)}</ul>}
        <p className="sd-delete-detail">画布中的图片和图层将一并永久删除。{confirm.some(entry => !isBoard(entry.sessionId)) && '原对话记录会保留。'}</p>
        <div className="sd-delete-actions">
          <button type="button" className="sd-button" disabled={busy} onClick={() => setConfirm(undefined)}>取消</button>
          <button type="button" className="sd-button sd-delete-button" disabled={busy} onClick={() => void remove()}>{busy ? '删除中…' : '确认删除'}</button>
        </div>
      </div>
    </ResearchDialog>}
  </>
}
