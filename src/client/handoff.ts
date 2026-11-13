import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { CanvasItem } from '../shared/types.js'

export type Outcome = 'filled' | 'busy' | 'copied' | 'unavailable'
type ItemReference = Pick<CanvasItem, 'id' | 'title'>
type Host = Pick<ClientContext, 'get'>
interface Binding { ctx: ClientContext }
interface SessionInput { state: { getSnapshot(): { draft: string; phase: string } }; focus?(): void }
interface InputService {
  for(ctx: ClientContext): SessionInput
  requestDraftInitialization?(binding: Binding, options: { prompt: string; whenDraftExists: 'append'; clearPreviousDraft: false }): 'applied' | 'preserved' | 'blocked'
}
export interface ConversationActions {
  reference(item: ItemReference): Promise<Outcome>
  edit(item: ItemReference): Promise<Outcome>
  prompt(text: string): Promise<Outcome>
  focus(): Promise<Outcome>
}
export const referenceText = (item: ItemReference): string => `[Seedream 图片 item:${item.id} ${item.title}] `

/** Append through the host's structured editor, preserving references, quotes and attachments. Never submit. */
async function handoff(ctx: Host, sessionId: string, text: string, duplicate?: string): Promise<Outcome> {
  const sessions = ctx.get('sessions') as unknown as { binding(id: string): Binding | undefined } | undefined
  const service = (ctx.get('conversation') as unknown as { input?: InputService } | undefined)?.input
  const mounted = (ctx.get('sidebarRight' as never) as unknown as { mounted?: { getSnapshot(): string | undefined } } | undefined)?.mounted
  const binding = sessions?.binding(sessionId)
  const visible = () => !mounted || mounted.getSnapshot() === sessionId
  if (binding && service?.for && visible()) {
    const input = service.for(binding.ctx), state = input.state.getSnapshot()
    if (['submitting', 'adjudicating', 'sending', 'submitted'].includes(state.phase)) return 'busy'
    if (!text || (duplicate && state.draft.includes(duplicate))) {
      input.focus?.()
      return 'filled'
    }
    if (service.requestDraftInitialization) {
      const result = service.requestDraftInitialization(binding, { prompt: text, whenDraftExists: 'append', clearPreviousDraft: false })
      if (result === 'blocked') return 'busy'
      if (result === 'applied') {
        queueMicrotask(() => { if (visible() && sessions?.binding(sessionId) === binding) input.focus?.() })
        return 'filled'
      }
    }
  }
  if (!text) return 'unavailable'
  try { await navigator.clipboard.writeText(text); return 'copied' } catch { return 'unavailable' }
}

export function referenceItem(ctx: Host, sessionId: string, item: ItemReference): Promise<Outcome> {
  return handoff(ctx, sessionId, referenceText(item), `item:${item.id}`)
}
export function conversationActions(ctx: Host, sessionId: string): ConversationActions {
  return {
    reference: item => referenceItem(ctx, sessionId, item),
    edit: item => handoff(ctx, sessionId, `请使用 Seedream 编辑 ${referenceText(item)}，修改要求：`, `item:${item.id}`),
    prompt: text => handoff(ctx, sessionId, `请使用 Seedream 生成图片：${text}`, text),
    focus: () => handoff(ctx, sessionId, ''),
  }
}
