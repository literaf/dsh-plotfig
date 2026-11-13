// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { act, createElement } from 'react'
import type { ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
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
    ctx.reflect.provide('sidebarRight', { mounted: { getSnapshot: () => undefined, subscribe: () => () => {} } })
    ctx.reflect.provide('sidebarRightTabs', { register: (d: { kind: string }) => { registered.push(d.kind); return unregister } })
    await new Promise(r => setTimeout(r, 0))
    expect(registered).toEqual(['seedream']); expect(seats).toContain('sidebar.right.pane.tab'); expect(seats).toContain('conversation.session.header.actions')
    await fiber.dispose(); expect(unregister).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('waits for the matching native Session to mount before announcing a running generation', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.stubGlobal('fetch', vi.fn(async (path: URL) => new Response(JSON.stringify(path.pathname.endsWith('/active')
      ? { ok: true, value: { active: { s: [{ key: 'pending-1', prompt: 'fixture', size: '1K', startedAt: new Date().toISOString() }] } } }
      : { ok: false, error: 'fixture' }), { headers: { 'Content-Type': 'application/json' } })))
    let mounted: string | undefined
    const listeners = new Set<() => void>(), openTab = vi.fn(), toggleExpanded = vi.fn()
    const right = { openTab, isExpanded: () => false, toggleExpanded, mounted: {
      getSnapshot: () => mounted, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    } }
    let Header: ComponentType<{ sessionId: string }> | undefined
    const ctx = new Context()
    ctx.reflect.provide('slots', { inject: (_name: string, cb: () => () => void) => cb(), register: (options: { name: string }, component: typeof Header) => {
      if (options.name === 'conversation.session.header.actions') Header = component
      return () => undefined
    } })
    ctx.reflect.provide('sidebarRightTabs', { register: () => () => undefined })
    ctx.reflect.provide('sidebarRight', right)
    const fiber = await ctx.plugin(browser as unknown as { inject: string[]; apply(c: Context): void })
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => { root.render(createElement(Header!, { sessionId: 's' })) })
      expect(openTab).not.toHaveBeenCalled()
      await act(async () => { mounted = 'other'; listeners.forEach(fn => fn()) })
      expect(openTab).not.toHaveBeenCalled()
      await act(async () => { mounted = 's'; listeners.forEach(fn => fn()) })
      expect(openTab).toHaveBeenCalledExactlyOnceWith('seedream'); expect(toggleExpanded).toHaveBeenCalledOnce()
      await act(async () => { mounted = undefined; listeners.forEach(fn => fn()) })
      await act(async () => { mounted = 's'; listeners.forEach(fn => fn()) })
      expect(openTab).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount()); await fiber.dispose(); visibility.mockRestore(); vi.unstubAllGlobals()
    }
  })
})
