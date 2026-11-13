import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Seedream } from './service.js'
import { checkSession } from './store.js'
import { parseGenerate } from './shared/types.js'
import type { Canvas, CanvasItem } from './shared/types.js'
import { parseDecompose } from './shared/layers.js'

const ITEM = { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string', required: true }, ref: { type: 'string', required: true }, title: { type: 'string', required: true },
  path: { type: 'string', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
  prompt: { type: 'string', required: true }, refs: { type: 'array', required: true, items: { type: 'string' } },
} } as const
const OUTPUT = { type: 'object', additionalProperties: false, properties: {
  session_id: { type: 'string', required: true }, created: { type: 'array', required: true, items: ITEM },
  items: { type: 'array', required: true, items: ITEM },
  composition_id: { type: 'string' },
} } as const
type Value = InferValue<typeof OUTPUT>
type Defaults = () => Promise<{ size: string; watermark: boolean }>
function sessionOf(exec: { agent?: { id: unknown } }): string {
  const id = exec.agent?.id
  if (typeof id !== 'string') throw new Error('Seedream 画布需要在对话中使用。')
  return checkSession(id)
}
function valueOf(service: Seedream, canvas: Canvas, created: CanvasItem[]): Value {
  const view = (i: CanvasItem) => ({ id: i.id, ref: `item:${i.id}`, title: i.title, path: service.store.imagePath(canvas.sessionId, i.id), width: i.width, height: i.height, prompt: i.prompt, refs: i.refs.map(r => `item:${r}`) })
  return { session_id: canvas.sessionId, created: created.map(view), items: canvas.items.map(view) }
}
function render(value: Value, generated: boolean) {
  const line = (i: Value['items'][number]) => `- ${i.title} · ${i.ref} · ${i.width}×${i.height}\n  [${i.path}](<${i.path}>)${i.refs.length ? `\n  参考：${i.refs.join(', ')}` : ''}`
  return [{ type: 'text' as const, text: (generated
    ? [`已生成 ${value.created.length} 张图片，并放到当前对话的 Seedream 画布上。`, ...value.created.map(line), `画布共有 ${value.items.length} 张图片。修改其中一张时，把它的 item 引用放进 images。`]
    : [value.items.length ? `当前对话的 Seedream 画布共有 ${value.items.length} 张图片（读取画布不计费）：` : '当前对话的 Seedream 画布还是空的。', ...value.items.map(line)]
  ).join('\n') }]
}
export function applyTools(ctx: Context, service: Seedream, defaults: Defaults): void {
  ctx.tools.register(defineTool({
    name: 'seedream_decompose',
    description: 'Split one existing canvas image into a background and independently editable transparent layers. Creates a separate artboard and preserves the original. Billed per output image; call only when the user requests splitting, never retry automatically. Dragging, text, shapes and exporting the resulting artboard are local and do not call the model.',
    parameters: {
      image: { type: 'string', required: true, description: 'Exactly one image reference from this Session, item:<id>. Use seedream_canvas to find it.' },
      prompt: { type: 'string', description: 'Optional instructions for which objects or text to separate.' },
      max_images: { type: 'integer', description: 'Maximum billed output images, including the background, from 2 to 100. Defaults to 30.' },
      size: { type: 'string', description: 'auto (default), 1K, 1.5K or 2K.' },
    },
    output: { schema: OUTPUT, render: (_a, v) => [{ type: 'text' as const, text: `已保存 ${v.created.length} 张分层素材，并创建可编辑图层画板。原图仍保留。画板 ID：${v.composition_id}\n在右侧画布打开“编辑图层”，可移动、添加文字图形或导出。\n${v.created.map(i => `${i.title} · ${i.ref} · ${i.path}`).join('\n')}` }] },
    timeoutMs: 600_000, isConcurrencySafe: () => false,
    presentCall: () => ({ card: 'generic', title: 'Seedream · 分图层', kind: 'other' }),
    async execute(args, exec) {
      const sessionId = sessionOf(exec), input = parseDecompose(args, (await defaults()).watermark)
      const result = await service.decompose(sessionId, input, exec.signal)
      return { ...valueOf(service, result.canvas, result.items), composition_id: result.composition.id }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'seedream_generate',
    description: 'Generate or edit images with Volcengine Seedream 5.5 and place the results on the current conversation\'s canvas. Each call is billed per output image; never repeat a call to "retry" without the user asking. For edits, pass the source as images: ["item:<id>"] and state both what changes and what must stay unchanged.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Full instruction. Chinese or English. For edits describe the change and what to keep.' },
      images: { type: 'array', items: { type: 'string' }, description: 'Up to 10 reference images: item:<id> from this canvas, https URLs, or absolute local file paths. Omit for text-to-image.' },
      size: { type: 'string', description: '1K, 1.5K, 2K (default from settings), or WxH with 921600–4624220 total pixels, e.g. 2560x1440.' },
      title: { type: 'string', description: 'Short Chinese label shown on the canvas, e.g. 雨林垂直分层剖面图.' },
    },
    output: { schema: OUTPUT, render: (_a, v) => render(v, true) }, timeoutMs: 240_000, isConcurrencySafe: () => false,
    presentCall: a => ({ card: 'generic', title: `Seedream · ${a.title ?? String(a.prompt).slice(0, 30)}`, kind: 'other' }),
    async execute(args, exec) {
      const sessionId = sessionOf(exec)
      const input = parseGenerate(args, await defaults())
      const { canvas, items } = await service.generate(sessionId, input, exec.signal, true)
      return valueOf(service, canvas, items)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'seedream_canvas',
    description: 'List the images on the current conversation\'s Seedream canvas with their item:<id> references, sizes, prompts and local paths. No API charge. Use before editing "the previous image" or an image the user referenced.',
    parameters: {}, output: { schema: OUTPUT, render: (_a, v) => render(v, false) }, isConcurrencySafe: () => true,
    async execute(_args, exec) { const sessionId = sessionOf(exec); return valueOf(service, await service.store.get(sessionId), []) },
  }))
  ctx.inject(['commands'], child => {
    const seen = new WeakMap<object, Set<string>>()
    child.commands.register({ name: 'seedream', description: 'Seedream 画图 · 生成或修改图片，结果放到画布上',
      input: { hint: '画一张热带雨林垂直分层剖面图，教材插画风格', images: false },
      async handler(invocation) {
        const text = invocation.rawInput.trim()
        if (!text) return { kind: 'success', text: '用法：/seedream + 画面描述。例：/seedream 画一张热带雨林垂直分层剖面图，教材插画风格。生成的图片会放到右侧 Seedream 画布，可在画布上继续编辑或引用。' }
        invocation.signal.throwIfAborted()
        const agent = invocation.agent, id = String(invocation.commandId)
        let receipts = seen.get(agent); if (!receipts) { receipts = new Set(); seen.set(agent, receipts) }
        if (receipts.has(id)) return { kind: 'success', text: '已加入当前对话。' }
        if (typeof agent.followup !== 'function') return { kind: 'error', text: '当前 Harness 不支持此命令。' }
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `/seedream ${text}` }] }))
        receipts.add(id); while (receipts.size > 128) receipts.delete(receipts.values().next().value!)
        return { kind: 'success', text: '已加入当前对话；将使用 Seedream 生成图片并放到画布上。' }
      },
    })
  })
}
