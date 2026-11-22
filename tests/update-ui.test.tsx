// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Controller } from '../src/client/controller.js'
import { UpdateCheck } from '../src/client/UpdateCheck.js'
import type { PluginUpdateManager } from '../src/client/plugin-update.js'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => vi.unstubAllGlobals())

async function mount(manager?: PluginUpdateManager) {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const controller = new Controller(() => { throw new Error('Unexpected credential access') })
  if (manager) controller.updateManager = manager
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node), manage = vi.fn()
  await act(async () => root.render(<UpdateCheck controller={controller} currentVersion="0.1.1" openPluginManager={manage}/>))
  const button = (label: string) => Array.from(node.querySelectorAll('button')).find(el => el.getAttribute('aria-label') === label || el.textContent === label)!
  const click = async (label: string) => act(async () => button(label).click())
  const cleanup = async () => { await act(async () => root.unmount()); controller.dispose(); node.remove() }
  return { fetch, node, button, click, manage, cleanup }
}
const ready = (status: 'available' | 'current' | 'ahead', latestVersion: string) =>
  Response.json({ ok: true, value: { currentVersion: '0.1.1', latestVersion, status } })

function registryManager(version = '0.1.1') {
  const listBundles = vi.fn<PluginUpdateManager['listBundles']>().mockResolvedValue({
    ok: true, value: [{ name: 'dsh-plotfig', version, installed: true, update: 'registry' }],
  })
  return { listBundles, updateBundle: vi.fn<PluginUpdateManager['updateBundle']>() }
}

describe('manual update button', () => {
  it.each(['applied', 'restart-required'] as const)('confirms the exact version in PlotFig and reports %s', async application => {
    const manager = registryManager()
    const ui = await mount(manager)
    try {
      let finish!: (answer: Awaited<ReturnType<PluginUpdateManager['updateBundle']>>) => void
      manager.updateBundle.mockImplementation(() => new Promise(resolve => { finish = resolve }))
      ui.fetch.mockResolvedValueOnce(ready('available', '0.2.1'))
      await ui.click('检查更新')
      expect(manager.listBundles).toHaveBeenCalledWith()
      expect(manager.updateBundle).not.toHaveBeenCalled()
      const button = ui.button('更新到 v0.2.1')
      await act(async () => { button.click(); button.click() })
      expect(manager.updateBundle.mock.calls).toEqual([['dsh-plotfig', '0.2.1', {}]])
      expect(ui.node.querySelector('[role=status]')?.textContent).toContain('正在更新')
      await ui.click('关闭PlotFig 更新')
      await ui.click('检查更新')
      expect(ui.fetch).toHaveBeenCalledTimes(1)
      expect(ui.button('更新到 v0.2.1')).toBeUndefined()
      await act(async () => finish({ ok: true, value: { step: 'install', to: '0.2.1', result: { application, version: '0.2.1' } } }))
      expect(ui.node.querySelector('[role=status]')?.textContent).toContain(application === 'applied' ? '更新完成' : '重启 DSH')
      expect(Array.from(ui.node.querySelectorAll('dd'), el => el.textContent)).toEqual(['0.2.1', '0.2.1'])
      expect(ui.manage).not.toHaveBeenCalled()
    } finally { await ui.cleanup() }
  })

  it('recognizes an installed version waiting for a restart without installing again', async () => {
    const manager = registryManager('0.2.1'), ui = await mount(manager)
    try {
      ui.fetch.mockResolvedValueOnce(ready('available', '0.2.1'))
      await ui.click('检查更新')
      expect(ui.node.querySelector('[role=status]')?.textContent).toContain('重启 DSH')
      expect(ui.button('更新到 v0.2.1')).toBeUndefined()
      expect(manager.updateBundle).not.toHaveBeenCalled()
    } finally { await ui.cleanup() }
  })

  it('reconciles the installed version before offering another update after a lost reply', async () => {
    const manager = registryManager(), ui = await mount(manager)
    try {
      ui.fetch.mockResolvedValueOnce(ready('available', '0.2.1'))
      manager.updateBundle.mockRejectedValueOnce(new Error('连接已中断'))
      await ui.click('检查更新')
      await ui.click('更新到 v0.2.1')
      expect(ui.node.querySelector('[role=alert]')?.textContent).toBe('连接已中断')
      manager.listBundles.mockResolvedValueOnce({ ok: true, value: [{ name: 'dsh-plotfig', installed: true, version: '0.2.1', update: 'registry' }] })
      ui.fetch.mockResolvedValueOnce(ready('available', '0.2.1'))
      await ui.click('重新检查')
      expect(ui.node.querySelector('[role=status]')?.textContent).toContain('重启 DSH')
      expect(manager.updateBundle).toHaveBeenCalledTimes(1)
    } finally { await ui.cleanup() }
  })

  it('rechecks the installed version after a failed update and preserves a non-registry installation', async () => {
    const manager = registryManager(), ui = await mount(manager)
    try {
      ui.fetch.mockResolvedValueOnce(ready('available', '0.2.1'))
      manager.updateBundle.mockResolvedValueOnce({ ok: true, value: {
        step: 'install', to: '0.2.1', result: { application: 'failed', error: { diagnostic: '下载失败。' } }, restore: { application: 'applied' },
      } })
      await ui.click('检查更新')
      await ui.click('更新到 v0.2.1')
      expect(ui.node.querySelector('[role=alert]')?.textContent).toContain('DSH 已恢复原版本')
      manager.listBundles.mockResolvedValueOnce({ ok: true, value: [{ name: 'dsh-plotfig', installed: true, version: '0.1.1', update: 'git' }] })
      ui.fetch.mockResolvedValueOnce(ready('available', '0.2.1'))
      await ui.click('重新检查')
      expect(ui.button('管理插件')).toBeDefined()
      expect(ui.button('更新到 v0.2.1')).toBeUndefined()
      expect(manager.updateBundle).toHaveBeenCalledTimes(1)
    } finally { await ui.cleanup() }
  })
  it('requests the plugin route only on click and opens the manager only on a second action', async () => {
    const ui = await mount()
    try {
      expect(ui.fetch).not.toHaveBeenCalled()
      ui.fetch.mockResolvedValueOnce(ready('available', '0.1.2'))
      await ui.click('检查更新')
      const [url, options] = ui.fetch.mock.calls[0]!
      expect(url.pathname).toBe('/api/seedream/update')
      expect(options.method).toBe('GET')
      expect(ui.node.querySelector('[role=status]')?.textContent).toBe('发现新版本')
      expect(Array.from(ui.node.querySelectorAll('dd'), el => el.textContent)).toEqual(['0.1.1', '0.1.2'])
      expect(ui.manage).not.toHaveBeenCalled()
      await ui.click('管理插件')
      expect(ui.manage).toHaveBeenCalledOnce()
      expect(ui.node.querySelector('[role=dialog]')).toBeNull()
      expect(ui.fetch).toHaveBeenCalledTimes(1)
    } finally { await ui.cleanup() }
  })

  it('offers a retry when offline and shows a newer local version without an update action', async () => {
    const ui = await mount()
    try {
      ui.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ready('ahead', '0.1.0'))
      await ui.click('检查更新')
      expect(ui.node.querySelector('[role=alert]')?.textContent).toContain('失败')
      await ui.click('重试')
      expect(ui.node.querySelector('[role=status]')?.textContent).toBe('当前版本高于最新正式版')
      expect(ui.node.textContent).not.toContain('管理插件')
    } finally { await ui.cleanup() }
  })

  it('aborts on dismissal and ignores an older answer after the dialog is reopened', async () => {
    const ui = await mount()
    try {
      let resolve!: (response: Response) => void
      ui.fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
      ui.fetch.mockResolvedValueOnce(ready('current', '0.1.1'))
      ui.button('检查更新').focus()
      await ui.click('检查更新')
      expect(ui.node.querySelector('[role=status]')?.textContent).toContain('正在检查')
      const signal = ui.fetch.mock.calls[0]![1].signal
      await ui.click('关闭PlotFig 更新')
      expect(signal.aborted).toBe(true)
      expect(document.activeElement).toBe(ui.button('检查更新'))
      await ui.click('检查更新')
      await act(async () => resolve(ready('available', '0.1.2')))
      expect(ui.node.querySelector('[role=status]')?.textContent).toBe('已是最新正式版')
      expect(ui.node.textContent).not.toContain('管理插件')
    } finally { await ui.cleanup() }
  })
})
