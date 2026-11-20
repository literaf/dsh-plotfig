// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import type { ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const compatRoot = process.env.DSH_COMPAT_ROOT
const local = createRequire(resolve('package.json'))
type Entry = { options: { key?: string; id?: string }; component: ComponentType<{ view?: 'page' | 'summary' }> }
type Registry = { register(options: object, component: () => null): () => void; entries(name: string): Entry[] }
function client(path: string, require: (id: string) => unknown): Record<string, unknown> {
  let factory: ((require: (id: string) => unknown) => Record<string, unknown>) | undefined
  new Function('window', readFileSync(path, 'utf8'))({ __ModuleLoader__: { load(entry: { factory: typeof factory }) { factory = entry.factory } } })
  if (!factory) throw new Error('Missing client factory')
  return factory(require)
}

describe('client bundle', () => {
  it('only requires platform modules', () => {
    const required = new Set([...readFileSync(resolve('lib/client.js'), 'utf8').matchAll(/require\("([^"]+)"\)/g)].map(m => m[1]))
    expect([...required].sort()).toEqual(['react', 'react/jsx-runtime'])
  })
})

describe.skipIf(!compatRoot)('native pages in the current published Harness', () => {
  it('mounts all key-setting entrances, shows errors, and disposes cleanly', async () => {
    const sdk = createRequire(resolve(compatRoot!, 'package.json'))
    const platform = (id: string) => id.startsWith('react') ? local(id) : sdk(id)
    const { SlotRegistry } = client(sdk.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), platform) as unknown as { SlotRegistry: new (ctx: unknown) => Registry }
    const { Context } = sdk('@deepseek-ai/cordis') as typeof import('@deepseek-ai/cordis')
    const ctx = new Context(), slots = new SlotRegistry(ctx)
    ctx.reflect.provide('locale', { bind: () => (key: string) => key, getLocale: () => ({ active: 'zh' }), subscribe: () => () => undefined })
    const browser = client(resolve('lib/client.js'), platform)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'fixture host unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    const fiber = await ctx.plugin(browser as { inject: string[]; apply(context: typeof ctx, config: object): void }, {})
    const container = document.createElement('div'), root = createRoot(container)
    let owner: (() => void) | undefined
    try {
      const children: Record<string, object> = { 'settings.section': { kind: 'list', scope: 'root' } }
      for (const [name, pkg] of [
        ['plugins.bundle.config', 'plugin-manager'], ['plugins.row.config', 'plugin-manager'], ['main', 'layout'], ['sidebar.panellist', 'sidebar'],
      ] as const) {
        const source = readFileSync(sdk.resolve(`@deepseek-ai/dsh-client-ui-${pkg}/client`), 'utf8')
        // Published hosts may minify string values to single quotes or backticks.
        const quote = '[\\x22\\x27\\x60]'
        const found = source.match(new RegExp(`"${name.replaceAll('.', '\\.')}":\\s*(\\{\\s*kind:\\s*${quote}\\w+${quote},\\s*scope:\\s*${quote}[\\w-]+${quote}\\s*\\})`))
        expect(found, name).not.toBeNull(); children[name] = new Function(`return (${found![1]})`)() as object
      }
      owner = slots.register({ name: 'root', children }, () => null)
      expect(slots.entries('plugins.bundle.config')[0]?.options.key).toBe('dsh-plotfig')
      expect(slots.entries('plugins.row.config')[0]?.options.key).toBe('dsh-plotfig#seedream')
      expect(slots.entries('settings.section')[0]?.options.id).toBe('seedream')
      expect(slots.entries('main')[0]?.options.key).toBe('seedream')
      const pages = ['plugins.bundle.config', 'plugins.row.config', 'settings.section'].map(name => slots.entries(name)[0]!)
      await act(async () => { root.render(createElement('div', {}, ...pages.map((p, key) => createElement(p.component, { key, view: 'page' })))) })
      const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')]
      expect(inputs).toHaveLength(3); expect(new Set(inputs.map(x => x.id)).size).toBe(3)
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(3)
      expect(container.textContent).toContain('fixture host unavailable')
      await act(async () => { root.render(createElement(pages[0]!.component, { view: 'summary' })) })
      expect(container.querySelectorAll('input')).toHaveLength(0)
      expect(container.textContent).toContain('打开详情配置方舟 Key')
      await act(async () => { root.unmount() }); await fiber.dispose()
      for (const name of Object.keys(children)) expect(slots.entries(name)).toHaveLength(0)
      expect(document.querySelector('style[data-plugin="dsh-plotfig"]')).toBeNull()
    } finally {
      await act(async () => { root.unmount() }); await fiber.dispose(); owner?.(); vi.unstubAllGlobals()
    }
  })
})
