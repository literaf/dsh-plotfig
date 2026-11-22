import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI4ScholarClient, AI4ScholarError } from '../src/ai4scholar.js'
import { apply, Config } from '../src/index.js'
import { drawingFetch, drawingQuote } from './fixtures.js'
import { Seedream } from '../src/service.js'
import { CanvasStore } from '../src/store.js'
import { readOCR } from '../src/shared/ocr.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'plotfig-api-')) })
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const client = (fetch: typeof globalThis.fetch) => new AI4ScholarClient({ fetch, apiKey: async () => 'sk-user-fixture', timeoutMs:10000, userAgent:'test' })
const png = (width: number, height: number) => Uint8Array.from(PNG.sync.write(new PNG({ width, height })))

describe('AI4Scholar drawing contract', () => {
  it('ignores legacy provider and credential settings at the plugin entry point', async () => {
    type Handler = (request: Request) => Promise<Response>
    const routes = new Map<string, Handler>()
    const bridge = { fetch: { register: (route: { path: string; fetch: Handler }) => routes.set(route.path, route.fetch) } }
    const resolve = vi.fn(async (ref: string) => ({ value: ref === 'AI4SCHOLAR_API_KEY' ? 'sk-user-shared' : 'legacy-provider-token' }))
    let credentials: { resolve: typeof resolve } | undefined
    const ctx = {
      tools: { register: vi.fn() }, systemPrompt: { section: vi.fn() },
      get: (service: string) => service === 'credentials' ? credentials : service === 'connection' ? bridge : undefined,
      inject: (services: string[], setup: (child: unknown) => void) => { if (services.includes('connection')) setup(ctx) },
    }
    const legacy = { provider: 'other', apiKeyEnv: 'OTHER_DRAWING_API_KEY', ai4scholarKeyEnv: 'OTHER_DRAWING_API_KEY' }
    vi.stubEnv('OTHER_DRAWING_API_KEY', 'legacy-provider-token')
    vi.stubEnv('AI4SCHOLAR_API_KEY', '')
    const network = vi.fn(drawingFetch(() => {}))
    vi.stubGlobal('fetch', network)
    const config = Config({ defaultSize: '2K', watermark: true, requestTimeoutMs: 10000, dataDirectory: root })
    apply(ctx as never, { ...config, ...legacy })
    const catalog = async () => (await routes.get('/api/seedream')!(new Request('http://host/api/seedream'))).json()
    const generate = async () => (await routes.get('/api/seedream/generate')!(new Request('http://host/api/seedream/generate?session=s',
      { method: 'POST', body: JSON.stringify({ prompt: 'diagram' }) }))).json()
    expect(await catalog()).toMatchObject({ ok: true, value: { keyRef: 'AI4SCHOLAR_API_KEY', configured: false, provider: 'ai4scholar', model: 'seedream55' } })
    expect(await generate()).toMatchObject({ ok: false, error: expect.stringContaining('AI4Scholar API Key') })
    vi.stubEnv('AI4SCHOLAR_API_KEY', 'legacy-provider-token')
    expect(await generate()).toMatchObject({ ok: false, error: expect.stringContaining('AI4Scholar API Key') })
    expect(network).not.toHaveBeenCalled()
    vi.stubEnv('AI4SCHOLAR_API_KEY', 'sk-user-fixture')
    expect(await generate()).toMatchObject({ ok: true })
    const authenticated = network.mock.calls.filter(([, init]) => new Headers(init?.headers).has('Authorization'))
    expect(authenticated.map(([url]) => String(url))).toEqual([
      'https://ai4scholar.net/api/proxy/nano/layers?maxImages=2', 'https://ai4scholar.net/api/proxy/nano/generate',
    ])
    for (const [, init] of authenticated) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-user-fixture')
      expect(init?.redirect).toBe('error')
    }
    credentials = { resolve }
    network.mockClear()
    expect(await generate()).toMatchObject({ ok: true })
    expect(new Set(resolve.mock.calls.map(([ref]) => ref))).toEqual(new Set(['AI4SCHOLAR_API_KEY']))
    expect(new Headers(network.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer sk-user-shared')
  })

  it('verifies the gateway, reads credits for free and preserves the generated alpha channel', async () => {
    const bytes = png(64, 32), posts: unknown[] = []
    const api = client(async (url, init) => {
      const target = new URL(String(url))
      if (target.hostname === 'storage.test') {
        expect(new Headers(init?.headers).has('Authorization')).toBe(false)
        return new Response(bytes)
      }
      expect(target.origin).toBe('https://ai4scholar.net')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-user-fixture')
      if (target.pathname.endsWith('/credits')) return json({credits:{total_available:75}})
      if (target.pathname.endsWith('/layers')) return json(drawingQuote(2))
      posts.push(JSON.parse(String(init?.body)))
      return json({success:true,imageUrl:'https://storage.test/result.png',creditCost:6})
    })
    expect((await api.check(new AbortController().signal)).message).toContain('75 积分')
    const out = await api.generate({prompt:'cut out',size:'2560x1440',background:'transparent',watermark:false,images:['data:image/png;base64,abc']}, new AbortController().signal)
    expect(posts).toEqual([{model:'seedream55',action:'edit',prompt:'cut out',size:'2560x1440',background:'transparent',watermark:false,images:['data:image/png;base64,abc']}])
    expect(out.creditCost).toBe(6)
    expect(PNG.sync.read(Buffer.from(out.images[0]!.bytes)).data[3]).toBe(0)
  })

  it.each(['jpeg', 'webp'] as const)('converts a %s provider image to PNG for subsequent editing', async format => {
    const source = sharp({ create: { width: 20, height: 14, channels: 4, background: { r: 60, g: 72, b: 90, alpha: 0.5 } } })
    const bytes = Uint8Array.from(await source.toFormat(format).toBuffer())
    const result = await client(drawingFetch(() => {}, bytes)).generate({ model: 'gptimage', prompt: 'diagram', size: '2K', images: [], watermark: false }, new AbortController().signal)
    const image = result.images[0]!
    expect(image).toMatchObject({ mime: 'image/png', width: 20, height: 14 })
    expect(PNG.sync.read(Buffer.from(image.bytes)).data[3]).toBe(format === 'jpeg' ? 255 : 128)
  })

  it('sends all edit references and uses generate for a prompt alone', async () => {
    const posts: Record<string, unknown>[] = []
    const api = client(drawingFetch(body => { posts.push(body) }))
    const request = { prompt: 'diagram', size: '2K', watermark: false, images: [] }
    const refs = ['https://reference.test/a', 'https://reference.test/b']
    await api.generate({ ...request, images: refs }, new AbortController().signal)
    await api.generate(request, new AbortController().signal)
    expect(posts).toMatchObject([{ action: 'edit', images: refs }, { action: 'generate', images: [] }])
  })

  it('keeps the gateway error and submits a rejected generation only once', async () => {
    const submit = vi.fn(() => json({ error: 'GENERATION_FAILED', message: 'blocked' }, 400))
    const api = client(drawingFetch(submit))
    const error = await api.generate({ prompt: 'test', images: [], size: '2K', watermark: false }, new AbortController().signal).catch(e => e)
    expect(error).toBeInstanceOf(AI4ScholarError)
    expect(error).toMatchObject({ code: 'GENERATION_FAILED', status: 400, message: expect.stringContaining('blocked') })
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid asset URLs, unexpected file content and oversized responses', async () => {
    const generate = async (imageUrl: string, download: () => Response) => client(async (url, init) => {
      if (String(url).includes('/layers?')) return json(drawingQuote(2))
      if (init?.method === 'POST') return json({ imageUrl })
      return download()
    }).generate({ prompt: 'test', images: [], size: '2K', watermark: false }, new AbortController().signal)
    const skipped = vi.fn(() => new Response())
    await expect(generate('http://storage.test/a', skipped)).rejects.toThrow('图片地址无效')
    expect(skipped).not.toHaveBeenCalled()
    await expect(generate('https://storage.test/a', () => new Response('<html>'))).rejects.toThrow('PNG')
    await expect(generate('https://storage.test/a', () => new Response('x', { headers: { 'content-length': String(65 * 1024 * 1024) } }))).rejects.toThrow('64 MB')
  })

  it('stops before sending an already cancelled request', async () => {
    const network = vi.fn<typeof fetch>()
    await expect(client(network).generate({ prompt: 'test', images: [], size: '2K', watermark: false }, AbortSignal.abort())).rejects.toThrow()
    expect(network).not.toHaveBeenCalled()
  })

  it('sends no generation to an older gateway that would drop native options', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}, 404))
    await expect(client(fetch).generate({prompt:'diagram',size:'1.5K',watermark:true,images:[]}, new AbortController().signal)).rejects.toThrow()
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['GET'])
  })

  it('recovers an unconfirmed paid submission after restart and imports thirteen layers once', async () => {
    const id = '14354ec4-f815-4070-841d-8d21f0973a5a', bytes = png(512,512)
    const store = new CanvasStore(root), meta = {title:'source',prompt:'diagram',refs:[],externalRefs:0,size:'512x512'}
    const original = (await store.add('board-test',[{bytes,width:512,height:512}],meta)).items[0]!
    const runs = [{text:'Dose',fontFamily:'Arial',fill:'#123456',bold:true,italic:false,underline:false,strikethrough:false,translucent:false,shadow:false}]
    const manifest = {version:1,layers:Array.from({length:13}, (_,i) => ({
      id:String(i),url:'https://storage.test/'+i,name:'Layer '+i,zIndex:i,x:10,y:20,width:120,height:80,
      ...(i>5 ? {ocr:{width:120,height:80,lines:[{x:5,y:6,width:70,height:20,fontSize:15,runs}]}} : {}),
    })),warnings:[]}
    let posts = 0
    const api = client(async (url,init) => {
      const target = new URL(String(url))
      if (target.hostname === 'storage.test') return new Response(bytes)
      if (init?.method === 'POST') {
        posts++
        const body=JSON.parse(String(init.body))
        expect(body).toMatchObject({requestId:id,maxImages:30,quotedCredits:182,watermark:true,size:'1.5K'})
        expect(body.image).toMatch(/^data:image\/png;base64,/)
        throw new TypeError('connection lost after commit')
      }
      expect(target.searchParams.get('taskId')).toBe(id)
      return json({taskId:id,status:'completed',result:manifest,creditCost:41,billing:{reservedCredits:182,chargedCredits:41,refundedCredits:141,standardOutputs:13,largeOutputs:0}})
    })
    const input={image:'item:'+original.id,requestId:id,quotedCredits:182,size:'1.5K',watermark:true,prompt:'split',maxImages:30}
    await expect(new Seedream(api,store).decompose('board-test',input,new AbortController().signal)).rejects.toThrow('connection lost')
    const reopenedStore = new CanvasStore(root), service = new Seedream(api,reopenedStore)
    const saved=await reopenedStore.get('board-test')
    expect(saved.layerTasks?.[0]?.id).toBe(id)
    service.resumeLayerTasks(saved,id)
    await vi.waitFor(async () => expect((await reopenedStore.get('board-test')).compositions).toHaveLength(1))
    const recovered=await service.decompose('board-test',input,new AbortController().signal)
    expect(recovered.canvas.layerTasks).toEqual([])
    expect(recovered.composition.layerTask?.billing).toEqual({reservedCredits:182,chargedCredits:41,refundedCredits:141,standardOutputs:13,largeOutputs:0})
    expect(recovered.items).toHaveLength(13)
    const ocr=recovered.items.map(item=>readOCR(item,recovered.composition)).filter(Boolean)
    expect(ocr).toHaveLength(7)
    expect(ocr[0]?.lines[0]).toMatchObject({x:5,y:6,runs})
    await expect(service.decompose('board-test',{...input,size:'2K'},new AbortController().signal)).rejects.toThrow('其他参数')
    expect(posts).toBe(1)
  })
})
