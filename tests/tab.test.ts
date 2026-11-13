// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as browser from '../src/client/index.js'

describe('right Sidebar tab', () => {
  it('registers the canvas tab type only where the host provides one, and unregisters on dispose', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'x' }), { headers: { 'Content-Type': 'application/json' } })))
    const registered: string[] = [], seats: string[] = []
    const ctx = new Context()
    ctx.reflect.provide('slots', { inject: (name: string, cb: () => () => void) => { seats.push(name); return cb() }, register: () => () => undefined })
    const fiber = await ctx.plugin(browser as unknown as { inject: string[]; apply(c: Context): void })
    expect(registered).toHaveLength(0); expect(seats).not.toContain('sidebar.right.pane.tab')
    const unregister = vi.fn()
    ctx.reflect.provide('sidebarRightTabs', { register: (d: { kind: string }) => { registered.push(d.kind); return unregister } })
    await new Promise(r => setTimeout(r, 0))
    expect(registered).toEqual(['seedream']); expect(seats).toContain('sidebar.right.pane.tab'); expect(seats).toContain('conversation.session.header.actions')
    await fiber.dispose(); expect(unregister).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
