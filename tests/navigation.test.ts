import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasNavigation, showCanvas } from '../src/client/navigation.js'

function fixture() {
  let sessionId: string | undefined = 'a'
  const listeners = new Set<() => void>()
  const right = { mounted: { getSnapshot: () => sessionId, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } } }, openTab: vi.fn(), isExpanded: () => false, toggleExpanded: vi.fn() }
  const openSession = vi.fn(), services: Record<string, unknown> = { sidebarRight: right, uiWorkspace: { openSession } }
  const nav = new CanvasNavigation({ get: (key: string) => services[key] } as never)
  const mount = (id?: string) => { sessionId = id; for (const fn of listeners) fn() }
  return { right, openSession, nav, mount, listeners }
}
afterEach(() => vi.useRealTimers())
describe('native canvas navigation', () => {
  it('opens only the named mounted session, never the foreground session of a background generation', () => {
    const f = fixture(); expect(showCanvas(f.right, 'b')).toBe(false); f.mount()
    expect(showCanvas(f.right, 'a')).toBe(false); expect(f.right.openTab).not.toHaveBeenCalled()
    f.mount('a'); expect(showCanvas(f.right, 'a')).toBe(true); expect(f.right.toggleExpanded).toHaveBeenCalledOnce()
  })
  it('returns a gallery item to its original conversation and waits for its canvas surface', () => {
    const f = fixture(); expect(f.nav.open('b')).toBe(true); expect(f.openSession).toHaveBeenCalledWith('b')
    f.mount(); expect(f.right.openTab).not.toHaveBeenCalled()
    f.mount('b'); expect(f.right.openTab).toHaveBeenCalledWith('seedream'); expect(f.listeners.size).toBe(0)
    f.nav.dispose()
  })
  it('cancels stale navigation after another choice, on disposal or after timeout', () => {
    vi.useFakeTimers(); const f = fixture()
    f.nav.open('b'); f.mount('c'); f.mount('b'); expect(f.right.openTab).not.toHaveBeenCalled()
    f.mount('a'); f.nav.open('b'); f.nav.dispose(); f.mount('b'); expect(f.right.openTab).not.toHaveBeenCalled()
    f.mount('a'); f.nav.open('b'); vi.advanceTimersByTime(8000); f.mount('b'); expect(f.right.openTab).not.toHaveBeenCalled()
    expect(f.listeners.size).toBe(0)
  })
})
