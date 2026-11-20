// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationActions, referenceItem, referenceText } from '../src/client/handoff.js'

const item = { id: 'abcdefabcdef', title: '雨林' }
function fixture(draft = '', phase = 'plain') {
  const state = { draft, phase }, binding = { ctx: {} }, current = { sessionId: 's' }
  const input = { state: { getSnapshot: () => state }, setDraft: vi.fn(), submit: vi.fn(), focus: vi.fn() }
  const append = vi.fn((_binding: unknown, options: { prompt: string }) => { state.draft += (state.draft ? '\n' : '') + options.prompt; return 'applied' })
  const services: Record<string, unknown> = {
    sessions: { binding: (id: string) => id === 's' ? binding : undefined },
    conversation: { input: { for: () => input, requestDraftInitialization: append } },
    sidebarRight: { mounted: { getSnapshot: () => current.sessionId } },
  }
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return { ctx: { get: (k: string) => services[k] } as never, state, binding, current, input, append, writeText, services }
}
afterEach(() => vi.restoreAllMocks())
describe('native draft handoff', () => {
  it('appends through the structured editor without replacing or sending, and deduplicates the item', async () => {
    const f = fixture('已有文字')
    expect(await referenceItem(f.ctx, 's', item)).toBe('filled')
    expect(f.append).toHaveBeenCalledWith(f.binding, { prompt: referenceText(item), whenDraftExists: 'append', clearPreviousDraft: false })
    expect(f.state.draft).toBe(`已有文字\n${referenceText(item)}`)
    expect(await referenceItem(f.ctx, 's', { ...item, title: '改过标题' })).toBe('filled')
    expect(f.append).toHaveBeenCalledTimes(1)
    expect(f.input.setDraft).not.toHaveBeenCalled(); expect(f.input.submit).not.toHaveBeenCalled()
  })
  it.each(['submitting', 'adjudicating', 'sending', 'submitted'])('does not touch a %s draft', async phase => {
    const f = fixture('保留', phase)
    expect(await referenceItem(f.ctx, 's', item)).toBe('busy')
    expect(f.append).not.toHaveBeenCalled(); expect(f.writeText).not.toHaveBeenCalled(); expect(f.state.draft).toBe('保留')
  })
  it('honors a host refusal even if its phase changed after the snapshot', async () => {
    const f = fixture(); f.append.mockReturnValue('blocked')
    expect(await referenceItem(f.ctx, 's', item)).toBe('busy'); expect(f.input.focus).not.toHaveBeenCalled()
  })
  it('never writes into or focuses another session, including a switch before deferred focus', async () => {
    const f = fixture(); f.current.sessionId = 'other'
    expect(await referenceItem(f.ctx, 's', item)).toBe('copied'); expect(f.append).not.toHaveBeenCalled()
    f.current.sessionId = 's'
    const pending = referenceItem(f.ctx, 's', item); f.current.sessionId = 'other'; await pending
    expect(f.input.focus).not.toHaveBeenCalled()
  })
  it('falls back to copying on older hosts instead of flattening their structured drafts', async () => {
    const f = fixture('已有内容')
    f.services.conversation = { input: { for: () => f.input } }
    expect(await referenceItem(f.ctx, 's', item)).toBe('copied')
    expect(f.writeText).toHaveBeenCalledWith(referenceText(item)); expect(f.input.setDraft).not.toHaveBeenCalled()
  })
  it('prepares edits and examples in the same native draft, and focus alone changes nothing', async () => {
    const f = fixture(), actions = conversationActions(f.ctx, 's')
    await actions.edit(item); expect(f.state.draft).toContain(`item:${item.id}`)
    await actions.prompt('画一只树蛙'); expect(f.state.draft).toContain('请使用 PlotFig 生成图片：画一只树蛙')
    const draft = f.state.draft; await actions.focus(); expect(f.state.draft).toBe(draft)
    expect(f.input.submit).not.toHaveBeenCalled(); expect(f.input.setDraft).not.toHaveBeenCalled()
  })
})
