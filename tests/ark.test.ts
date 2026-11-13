import { describe, expect, it, vi } from 'vitest'
import { ArkClient, ArkError, ENDPOINT, imageInfo } from '../src/ark.js'
import { parseGenerate, parseSize, MODEL } from '../src/shared/types.js'
import { png } from './fixtures.js'

const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
const client = (fetch: typeof globalThis.fetch, timeoutMs = 5000) => new ArkClient({ apiKey: async () => 'secret', timeoutMs, userAgent: 'test', fetch })
const request = { prompt: '雨林', images: [], size: '2K', watermark: true }
describe('size and input validation', () => {
  it('accepts tiers and pixel-bounded WxH, never both', () => {
    expect(parseSize(undefined, '2K')).toBe('2K'); expect(parseSize('1.5k', '2K')).toBe('1.5K'); expect(parseSize('2560×1440', '2K')).toBe('2560x1440')
    for (const bad of ['4K', '2K 2048x2048', '100x100', '4000x4000', '4800x200', 12]) expect(() => parseSize(bad, '2K')).toThrow()
  })
  it('limits references, prompt length and types', () => {
    const defaults = { size: '2K', watermark: true }
    expect(parseGenerate({ prompt: ' x ', title: ' 标题 ' }, defaults)).toEqual({ prompt: 'x', images: [], size: '2K', watermark: true, title: '标题' })
    for (const bad of [{}, { prompt: '' }, { prompt: 'x'.repeat(4001) }, { prompt: 'x', images: Array(11).fill('item:aaaaaaaaaaaa') }, { prompt: 'x', images: [1] }, { prompt: 'x', watermark: 'no' }]) expect(() => parseGenerate(bad, defaults)).toThrow()
  })
  it('reads PNG and JPEG dimensions', () => {
    expect(imageInfo(png(1330, 1773))).toEqual({ width: 1330, height: 1773, mime: 'image/png' })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x02, 0x00, 0x03, 0x00, 3, 0, 0])
    expect(imageInfo(jpeg)).toEqual({ width: 768, height: 512, mime: 'image/jpeg' })
    expect(imageInfo(new TextEncoder().encode('<html>not an image</html>'))).toBeUndefined()
  })
})
describe('Ark contract', () => {
  it('sends the fixed model and downloads results immediately', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init])
      return calls.length === 1 ? ok({ data: [{ url: 'https://cdn.example/a.png' }], usage: { generated_images: 1 } }) : new Response(png(2048, 2048))
    }) as unknown as typeof globalThis.fetch
    const result = await client(fetch).generate({ ...request, images: ['data:image/png;base64,AAAA'] }, new AbortController().signal)
    expect(calls[0]![0]).toBe(ENDPOINT)
    const body = JSON.parse(calls[0]![1]!.body as string)
    expect(body).toEqual({ model: MODEL, prompt: '雨林', size: '2K', watermark: true, response_format: 'url', output_format: 'png', image: 'data:image/png;base64,AAAA' })
    expect((calls[0]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer secret')
    expect(calls[1]![0]).toBe('https://cdn.example/a.png')
    expect(result.images[0]).toMatchObject({ width: 2048, height: 2048 }); expect(result.generated).toBe(1)
  })
  it('sends several references as an array and none for text-to-image', async () => {
    const bodies: unknown[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.body) { bodies.push(JSON.parse(init.body as string)); return ok({ data: [{ url: 'https://cdn.example/a.png' }] }) }
      return new Response(png(1024, 1024))
    }) as unknown as typeof globalThis.fetch
    await client(fetch).generate({ ...request, images: ['https://a.example/1.png', 'https://a.example/2.png'] }, new AbortController().signal)
    await client(fetch).generate(request, new AbortController().signal)
    expect((bodies[0] as { image: unknown }).image).toEqual(['https://a.example/1.png', 'https://a.example/2.png'])
    expect(bodies[1]).not.toHaveProperty('image')
  })
  it('reports Ark error codes without retrying', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'InputTextSensitiveContentDetected', message: 'blocked' } }), { status: 400 })) as unknown as typeof globalThis.fetch
    const error = await client(fetch).generate(request, new AbortController().signal).catch(e => e)
    expect(error).toBeInstanceOf(ArkError); expect(error.message).toContain('InputTextSensitiveContentDetected'); expect(error.message).toContain('blocked')
    expect(fetch).toHaveBeenCalledTimes(1)
    const unauthorized = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'AuthenticationError', message: 'bad key' } }), { status: 401 })) as unknown as typeof globalThis.fetch
    expect((await client(unauthorized).generate(request, new AbortController().signal).catch(e => e)).message).toContain('API Key')
  })
  it('rejects non-https result URLs and non-image downloads', async () => {
    const http = vi.fn(async () => ok({ data: [{ url: 'http://cdn.example/a.png' }] })) as unknown as typeof globalThis.fetch
    await expect(client(http).generate(request, new AbortController().signal)).rejects.toThrow('无效的图片地址')
    let n = 0
    const html = vi.fn(async () => ++n === 1 ? ok({ data: [{ url: 'https://cdn.example/a.png' }] }) : new Response('<html>')) as unknown as typeof globalThis.fetch
    await expect(client(html).generate(request, new AbortController().signal)).rejects.toThrow('不是有效的')
    n = 0
    const huge = vi.fn(async () => ++n === 1 ? ok({ data: [{ url: 'https://cdn.example/a.png' }] }) : new Response('x', { headers: { 'content-length': String(31 * 1024 * 1024) } })) as unknown as typeof globalThis.fetch
    await expect(client(huge).generate(request, new AbortController().signal)).rejects.toThrow('30 MB')
  })
  it('honours caller cancellation', async () => {
    const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof globalThis.fetch
    const control = new AbortController(), pending = client(fetch).generate(request, control.signal)
    control.abort(); await expect(pending).rejects.toThrow()
  })
})
