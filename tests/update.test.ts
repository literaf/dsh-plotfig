import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdate, compareStableRelease, VERSION } from '../src/update.js'

afterEach(() => vi.unstubAllGlobals())

describe('PlotFig release checks', () => {
  it.each([
    ['0.1.9', '0.1.10', 'available'],
    ['0.2.0-rc.2', '0.2.0', 'available'],
    ['0.2.0+local.1', '0.2.0', 'current'],
    ['1.0.0-beta.1', '0.99.9', 'ahead'],
  ])('compares installed %s with stable %s', (installed, latest, expected) => {
    expect(compareStableRelease(installed, latest)).toBe(expected)
  })

  it('looks up the PlotFig latest tag without credentials and propagates cancellation', async () => {
    const latestVersion = '1.2.10'
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ name: 'dsh-plotfig', version: latestVersion }))
    vi.stubGlobal('fetch', fetch)
    const request = new AbortController()
    expect(await checkForUpdate(request.signal)).toEqual({ currentVersion: VERSION, latestVersion, status: compareStableRelease(VERSION, latestVersion) })
    const [url, options] = fetch.mock.calls[0]!
    expect(url).toBe('https://registry.npmjs.org/dsh-plotfig/latest')
    expect(options.headers).toEqual({ Accept: 'application/json' })
    expect(options.cache).toBe('no-store')
    request.abort()
    expect(options.signal?.aborted).toBe(true)
  })

  it('rejects registry errors, unexpected packages and invalid stable releases', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const reply of [
      new Response(null, { status: 503 }), new Response('offline'),
      Response.json({ name: 'dsh-research', version: '1.2.3' }),
      Response.json({ name: 'dsh-plotfig', version: '0.3.0-rc.1' }),
      Response.json({ name: 'dsh-plotfig', version: '0.01.3' }),
    ]) {
      fetch.mockResolvedValueOnce(reply)
      await expect(checkForUpdate(new AbortController().signal)).rejects.toThrow()
    }
  })
})
