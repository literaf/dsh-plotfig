import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-commands'
import { KEY_REF, MODEL, SIZE_TIERS } from './shared/types.js'
import type { SizeTier } from './shared/types.js'
import { ArkClient } from './ark.js'
import { CanvasStore } from './store.js'
import { Seedream } from './service.js'
import { Preferences } from './preferences.js'
import { applyRoutes } from './routes.js'
import { applyTools } from './tools.js'
export const name = 'seedream'
export const inject = ['tools', 'systemPrompt']
export const VERSION: string = createRequire(import.meta.url)('../package.json').version
export interface Config { apiKeyEnv: string; defaultSize: SizeTier; watermark: boolean; requestTimeoutMs: number; dataDirectory?: string }
export const Config: Schema<Config> = Schema.object({
  apiKeyEnv: Schema.string().default(KEY_REF).description('Volcengine Ark API key credential reference.'),
  defaultSize: Schema.union([...SIZE_TIERS]).default('2K').description('Initial default output size; can be changed in the settings card.'),
  watermark: Schema.boolean().default(true).description('Initial watermark setting (Ark adds "AI 生成" at the bottom right).'),
  requestTimeoutMs: Schema.natural().min(10000).max(600000).default(180000),
  dataDirectory: Schema.string().description('Optional absolute data directory. Defaults to $DSH_HOME/seedream.'),
})
export function apply(ctx: Context, config: Config): void {
  const ref = credentialRef(config.apiKeyEnv ?? KEY_REF)
  const resolveKey = async () => {
    const service = ctx.get('credentials')
    const value = service ? (await service.resolve(ref))?.value : process.env[ref]
    return value?.trim() || undefined
  }
  const root = config.dataDirectory ? resolve(config.dataDirectory) : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'seedream')
  const prefs = new Preferences(join(root, 'settings.json'), { size: config.defaultSize ?? '2K', watermark: config.watermark ?? true })
  const ark = new ArkClient({ timeoutMs: config.requestTimeoutMs ?? 180000, userAgent: `dsh-plotfig/${VERSION}`,
    apiKey: async () => { const key = await resolveKey(); if (!key) throw new Error('请先在 Seedream 设置中保存方舟 API Key。'); return key },
  })
  const service = new Seedream(ark, new CanvasStore(join(root, 'canvases')))
  applyTools(ctx, service, () => prefs.get())
  applyRoutes(ctx, service, prefs, async () => {
    const p = await prefs.get()
    return { version: VERSION, configured: (await resolveKey()) !== undefined, keyRef: ref, model: MODEL, defaultSize: p.size, watermark: p.watermark }
  })
  ctx.systemPrompt.section({ name: 'seedream:workflow', order: 159, text: [
    'dsh-plotfig (PlotFig) provides /seedream and a per-conversation canvas (right sidebar tab "PlotFig 画布"). Use seedream_generate to create or edit images and seedream_canvas to list what is already on the canvas.',
    'Every seedream_generate call is billed per output image. Do not call it again to retry or to produce variants unless the user asks. Read the canvas first instead of regenerating an existing image.',
    'When the user asks for a set of different images (several figures for one paper, a series in one style), use seedream_generate_batch with one complete prompt per image instead of repeated seedream_generate calls. It bills one image per item and reports any failed item without retrying.',
    'Use seedream_decompose only when the user requests splitting an image into layers. It is billed per output image (background included); never retry automatically. Editable artboards preserve the original and support local drag, resize, text, shapes and PNG export without further model calls.',
    'Use seedream_edit only when the user requests background removal, erasing objects, redrawing boxed regions (inpaint), expanding or enhancing an image. Read seedream_canvas first and use its item reference and exact pixel dimensions. Erase requires rectangles; expand requires added pixel margins. Each edit is billed for one image, never retry automatically, and originals are retained. The UI also offers painted masks, editable OCR and local layered PSD export.',
    'Write rich, specific prompts (subject, composition, style, text to render, colors). For edits pass the source as images: ["item:<id>"] and say what to change and what must stay the same.',
    'A user message may contain [PlotFig 图片 item:<id>] references from the canvas (older conversations show [Seedream 图片 item:<id>]); pass those exact item:<id> references in images.',
    'After generating, describe the result briefly and give the local file path. The image is already on the canvas; the user can open it from the conversation header or the Seedream panel.',
  ].join('\n') })
}
