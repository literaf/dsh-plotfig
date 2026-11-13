import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { CanvasItem } from '../shared/types.js'
export type Outcome = 'filled' | 'busy' | 'copied' | 'unavailable'
interface SessionInput { state: { getSnapshot(): { draft: string; phase: string } }; setDraft(text: string): void; focus?(): void }
interface Sessions { binding(id: string): { ctx: ClientContext } | undefined }
export const referenceText = (item: Pick<CanvasItem, 'id' | 'title'>): string => `[Seedream 图片 item:${item.id} ${item.title}] `
/**
 * Append a canvas reference to this Session's draft without sending it. An
 * existing draft is kept and the reference goes after it; a draft that is
 * already being submitted is never touched.
 */
export async function referenceItem(ctx: Pick<ClientContext, 'get'>, sessionId: string, item: Pick<CanvasItem, 'id' | 'title'>): Promise<Outcome> {
  const text = referenceText(item)
  const sessions = ctx.get('sessions') as unknown as Sessions | undefined
  const conversation = ctx.get('conversation') as unknown as { input?: { for(ctx: ClientContext): SessionInput } } | undefined
  const binding = sessions?.binding?.(sessionId)
  const input = binding && conversation?.input?.for ? conversation.input.for(binding.ctx) : undefined
  if (input) {
    const state = input.state.getSnapshot()
    if (['submitting', 'adjudicating', 'submitted'].includes(state.phase)) return 'busy'
    const draft = state.draft
    if (draft.includes(text.trim())) { queueMicrotask(() => input.focus?.()); return 'filled' }
    input.setDraft(draft && !/\s$/.test(draft) ? `${draft} ${text}` : draft + text)
    queueMicrotask(() => input.focus?.())
    return 'filled'
  }
  try { await navigator.clipboard.writeText(text); return 'copied' } catch { return 'unavailable' }
}
