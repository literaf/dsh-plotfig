import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Seedream } from './service.js'
import { checkSession } from './store.js'
import { parseGenerate } from './shared/types.js'
import { DRAWING_MODELS, MODEL, MODEL_IDS } from './shared/models.js'
import type { Canvas, CanvasItem } from './shared/types.js'
import { parseDecompose } from './shared/layers.js'
import { randomUUID } from 'node:crypto'
import { parseImageEdit, IMAGE_EDIT_LABELS } from './shared/image-edit.js'
import { STYLE_IDS, styleName } from './shared/research.js'

const ITEM = { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string', required: true }, ref: { type: 'string', required: true }, title: { type: 'string', required: true },
  path: { type: 'string', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
  model: { type: 'string' }, prompt: { type: 'string', required: true }, refs: { type: 'array', required: true, items: { type: 'string' } },
} } as const
const OUTPUT = { type: 'object', additionalProperties: false, properties: {
  session_id: { type: 'string', required: true }, created: { type: 'array', required: true, items: ITEM },
  items: { type: 'array', required: true, items: ITEM },
  composition_id: { type: 'string' }, charged_credits: { type: 'number' }, refunded_credits: { type: 'number' },
  warnings: { type: 'array', items: { type: 'string' } },
  generation_style: { type: 'string' },
  generation_model: { type: 'string' },
} } as const
type Value = InferValue<typeof OUTPUT>
type Defaults = () => Promise<{ size: string; watermark: boolean }>
function sessionOf(exec: { agent?: { id: unknown } }): string {
  const id = exec.agent?.id
  if (typeof id !== 'string') throw new Error('PlotFig 画布需要在对话中使用。')
  return checkSession(id)
}
function valueOf(service: Seedream, canvas: Canvas, created: CanvasItem[]): Value {
  const view = (i: CanvasItem) => ({ id: i.id, ref: `item:${i.id}`, title: i.title, path: service.store.imagePath(canvas.sessionId, i.id), width: i.width, height: i.height, ...(i.model && { model: i.model }), prompt: i.prompt, refs: i.refs.map(r => `item:${r}`) })
  // Older versions of regenerated images stay saved but are not offered to the agent.
  return { session_id: canvas.sessionId, created: created.map(view), items: canvas.items.filter(i => !i.superseded).map(view), generation_style: canvas.generationStyle ?? 'auto', generation_model: canvas.generationModel ?? MODEL }
}
function render(value: Value, generated: boolean) {
  const line = (i: Value['items'][number]) => `- ${i.title} · ${i.ref} · ${i.width}×${i.height}\n  [${i.path}](<${i.path}>)${i.refs.length ? `\n  参考：${i.refs.join(', ')}` : ''}`
  return [{ type: 'text' as const, text: (generated
    ? [`已生成 ${value.created.length} 张图片，并放到当前对话的 PlotFig 画布上。`, ...value.created.map(line), `画布共有 ${value.items.length} 张图片。修改其中一张时，把它的 item 引用放进 images。`]
    : [value.items.length ? `当前对话的 PlotFig 画布共有 ${value.items.length} 张图片（读取画布不计费）：` : '当前对话的 PlotFig 画布还是空的。', ...value.items.map(line)]
  ).concat(value.generation_style && value.generation_style !== 'auto' ? [`当前画布生图风格：${styleName(value.generation_style as Parameters<typeof styleName>[0])}。后续 seedream_generate 默认应用，style: auto 可单次关闭。`] : [], value.warnings ?? []).join('\n') }]
}
export function applyTools(ctx: Context, service: Seedream, defaults: Defaults): void {
  ctx.tools.register(defineTool({
    name: 'seedream_layer_quote',
    description: 'Get the current layer split price and supported output cap before submitting a paid task. Free.',
    parameters: { max_images: { type: 'integer', description: 'Desired maximum including the background, 2–100. Default 30.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      enabled: { type: 'boolean', required: true }, max_images: { type: 'integer', required: true },
      supported_max_images: { type: 'integer', required: true }, quoted_credits: { type: 'integer' }, metered: { type: 'boolean' },
    } }, render: (_args, value) => [{ type: 'text' as const, text: value.enabled && value.quoted_credits !== undefined
      ? `本次最多输出 ${value.max_images} 张，${value.metered ? `最高预留 ${value.quoted_credits} 积分，按实际交付图片结算并退回差额。` : `共 ${value.quoted_credits} 积分。`}`
      : `所选张数尚未开放，当前支持上限为 ${value.supported_max_images} 张。` }] },
    isConcurrencySafe: () => true,
    async execute(args) {
      const q = await service.layerQuote(args.max_images ?? 30)
      return { enabled: q.enabled, metered: !!q.pricing, max_images: q.maxImages, supported_max_images: q.supportedMaxImages, ...(q.creditCost == null ? {} : { quoted_credits: q.creditCost }) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'seedream_edit',
    description: 'Remove an image background, erase selected regions, redraw selected regions from a description (inpaint), extend the canvas, or enhance (upscale and sharpen) an image with Seedream 5.5. Billed per generated image: one, except multi-sided expansion which bills one per side. Use only when requested; never retry automatically. The original stays intact and results are saved to this Session. Erase and inpaint protect pixels outside the supplied rectangles; inpaint requires a prompt describing what to draw; expansion preserves all pixels of the original rectangle. Enhance outputs up to ~4.62 MP and flags results that drift from the source. Inspect dimensions with seedream_canvas first. UI users can paint masks in AI 处理 instead.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['remove-background', 'erase', 'inpaint', 'expand', 'enhance'] },
      image: { type: 'string', required: true, description: 'One item:<id> from this Session; local paths and external URLs are not accepted.' },
      prompt: { type: 'string', description: 'Which foreground to keep, what to erase, what to draw inside the regions (required for inpaint), or what scene to extend.' },
      feather: { type: 'number', description: 'Erase and inpaint: inward edge transition in pixels, integer 0–64. Default adapts to resolution; 0 keeps a hard edge. Include some background around the object in the selection.' },
      regions: { type: 'array', description: 'Required for erase (1–64) and inpaint (1–16): rectangles in original-image pixel coordinates. Must stay within the source image.', items: { type: 'object', additionalProperties: false, properties: {
        x: { type: 'integer', required: true }, y: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
      } } },
      expand: { type: 'object', description: 'Required for expand: nonnegative added pixels on each side. Each positive side is one local-context pass that preserves original pixels; several sides run left, right, top, bottom in sequence, one billed image per side. If a later pass fails, the completed part is saved; never retry automatically.', additionalProperties: false, properties: {
        left: { type: 'integer', required: true }, top: { type: 'integer', required: true }, right: { type: 'integer', required: true }, bottom: { type: 'integer', required: true },
      } },
      request_id: { type: 'string', description: 'Optional stable request identifier, 8–80 ASCII letters/digits/_/-. Reusing the same id and inputs returns the original result instead of charging again.' },
    },
    output: { schema: OUTPUT, render: (_a, v) => render(v, true) }, timeoutMs: 600_000, isConcurrencySafe: () => false,
    presentCall: a => ({ card: 'generic', title: `Seedream · ${IMAGE_EDIT_LABELS[a.operation as keyof typeof IMAGE_EDIT_LABELS] ?? '图片编辑'}`, kind: 'other' }),
    async execute(args, exec) {
      const input = parseImageEdit({ ...args, requestId: args.request_id ?? randomUUID() }, (await defaults()).watermark)
      const result = await service.editImage(sessionOf(exec), input, exec.signal)
      return { ...valueOf(service, result.canvas, result.items), warnings: result.warnings }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'seedream_decompose',
    description: 'Split a canvas image into editable layers. Get the current quote with seedream_layer_quote and pass the confirmed maximum reservation as quoted_credits. Never retry paid submissions automatically.',
    parameters: {
      image: { type: 'string', required: true, description: 'Exactly one image reference from this Session, item:<id>. Use seedream_canvas to find it.' },
      prompt: { type: 'string', description: 'Optional instructions for which objects or text to separate.' },
      max_images: { type: 'integer', description: 'Maximum number of output images in one split, including the background, from 2 to 100. Defaults to 30.' },
      size: { type: 'string', description: 'auto (default), 1K, 1.5K or 2K.' },
      quoted_credits: { type: 'integer', description: 'Required for a new task. Pass the confirmed ceiling from seedream_layer_quote for this output cap.' },
      request_id: { type: 'string', description: 'Stable UUID v4 for retrieving the same AI4Scholar split task.' },
    },
    output: { schema: OUTPUT, render: (_a, v) => [{ type: 'text' as const, text: `已保存 ${v.created.length} 张分层素材，并创建可编辑图层画板。${v.charged_credits == null ? '' : `实收 ${v.charged_credits} 积分，已退回 ${v.refunded_credits} 积分。`}画板 ID：${v.composition_id}\n在右侧画布打开“编辑图层”，可移动、添加文字图形或导出。\n${v.created.map(i => `${i.title} · ${i.ref} · ${i.path}`).join('\n')}` }] },
    timeoutMs: 600_000, isConcurrencySafe: () => false,
    presentCall: () => ({ card: 'generic', title: 'Seedream · 分图层', kind: 'other' }),
    async execute(args, exec) {
      const sessionId = sessionOf(exec), input = parseDecompose(args, (await defaults()).watermark)
      const result = await service.decompose(sessionId, input, exec.signal)
      return { ...valueOf(service, result.canvas, result.items), composition_id: result.composition.id,
        ...(result.composition.layerTask?.billing && { charged_credits: result.composition.layerTask.billing.chargedCredits, refunded_credits: result.composition.layerTask.billing.refundedCredits }) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'seedream_generate',
    description: 'Generate or edit images through AI4Scholar using the model selected on the current PlotFig canvas (initially Seedream 5.5). AI4Scholar charges credits per image. Never retry without the user asking. For edits, pass the source as images: ["item:<id>"] and describe the requested changes.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Full instruction. Chinese or English. For edits describe the change and what to keep.' },
      images: { type: 'array', items: { type: 'string' }, description: 'Up to 10 reference images: item:<id> from this canvas, https URLs, or absolute local file paths. Omit for text-to-image.' },
      model: { type: 'string', enum: MODEL_IDS, description: 'Omit to use the canvas selection. Override for one request when the user asks.' },
      size: { type: 'string', description: 'Resolution supported by the model. Seedream also accepts exact WxH. Omit for a compatible default.' },
      aspect_ratio: { type: 'string', description: 'GPT Image and Nano Banana only, e.g. 4:3 or 16:9. Default auto.' },
      title: { type: 'string', description: 'Short Chinese label shown on the canvas, e.g. 雨林垂直分层剖面图.' },
      opaque: { type: 'boolean', description: 'Seedream 5.5 only. Force an opaque RGB result. Recommended when editing a canvas image again and again (pass the previous result in images), for consistency across rounds. Do not combine with transparent.' },
      transparent: { type: 'boolean', description: 'Seedream 5.5 only. Output a PNG with a transparent background: only the subject, nothing behind it. Suits icons, devices and parts to place in figures. Works with or without reference images.' },
      style: { type: 'string', enum: STYLE_IDS, description: 'Optional scientific illustration appearance. Omit to inherit the style selected on this Session canvas. auto uses only the supplied prompt; flat, 2.5d, line-art, naturalistic, 3d, hand-drawn apply an appearance preset; journal is accepted only for legacy compatibility. Subject, figure type, viewpoint and palette are independent. This is not a scientific accuracy or journal-compliance guarantee.' },
    },
    output: { schema: OUTPUT, render: (_a, v) => render(v, true) }, timeoutMs: 240_000, isConcurrencySafe: () => false,
    presentCall: a => ({ card: 'generic', title: `${a.model ? DRAWING_MODELS[a.model].label : 'PlotFig'} · ${a.title ?? String(a.prompt).slice(0, 30)}`, kind: 'other' }),
    async execute(args, exec) {
      const sessionId = sessionOf(exec)
      const input = parseGenerate({ ...args, aspectRatio: args.aspect_ratio }, await service.generationDefaults(sessionId, await defaults()))
      const { canvas, items } = await service.generate(sessionId, input, exec.signal, true)
      return valueOf(service, canvas, items)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'seedream_generate_batch',
    description: 'Generate a planned set of 2–10 different images in one call, e.g. "four figures for this paper in one consistent style". Write one complete prompt per image; shared size, style and references apply to every item unless an item overrides them. Items run one after another and each is billed once; a failed item is reported and never retried, and the others still complete. Use seedream_generate for a single image.',
    parameters: {
      items: { type: 'array', required: true, description: '2–10 images in order. Each needs its own full prompt; repeat the shared visual style in every prompt for consistency.', items: { type: 'object', additionalProperties: false, properties: {
        prompt: { type: 'string', required: true }, title: { type: 'string' }, size: { type: 'string' },
        images: { type: 'array', items: { type: 'string' }, description: 'Item-specific references, added after the shared ones.' },
      } } },
      images: { type: 'array', items: { type: 'string' }, description: 'Shared references for every item: item:<id>, https URLs or absolute local paths. Up to 10 per item including item-specific ones.' },
      model: { type: 'string', enum: MODEL_IDS, description: 'Model for this batch. Omit to use the canvas selection.' },
      size: { type: 'string', description: 'Shared resolution supported by the selected model. Seedream also accepts WxH.' },
      aspect_ratio: { type: 'string', description: 'Shared GPT Image or Nano Banana aspect ratio, e.g. 4:3.' },
      style: { type: 'string', enum: STYLE_IDS, description: 'Shared appearance preset; omit to inherit the canvas style.' },
      transparent: { type: 'boolean', description: 'Seedream 5.5 only. Transparent-background PNGs for every item.' },
    },
    output: { schema: OUTPUT, render: (_a, v) => render(v, true) }, timeoutMs: 1_800_000, isConcurrencySafe: () => false,
    presentCall: a => ({ card: 'generic', title: `${a.model ? DRAWING_MODELS[a.model].label : 'PlotFig'} · 批量 ${Array.isArray(a.items) ? a.items.length : ''} 张`, kind: 'other' }),
    async execute(args, exec) {
      const sessionId = sessionOf(exec), base = await service.generationDefaults(sessionId, await defaults())
      const list = Array.isArray(args.items) ? args.items : []
      if (list.length < 2 || list.length > 10) throw new Error('批量生成需要 2–10 个条目；单张请用 seedream_generate。')
      const shared = Array.isArray(args.images) ? args.images : []
      // Validate everything before the first billed request.
      const inputs = list.map((item, i) => {
        try { return parseGenerate({ ...item, model: args.model, aspectRatio: args.aspect_ratio, images: [...shared, ...(item.images ?? [])], size: item.size ?? args.size, style: args.style, transparent: args.transparent }, base) }
        catch (error) { throw new Error(`第 ${i + 1} 项参数无效：${error instanceof Error ? error.message : '格式错误'}`) }
      })
      const created: CanvasItem[] = [], warnings: string[] = []
      let canvas: Canvas | undefined
      for (const [i, input] of inputs.entries()) {
        if (exec.signal.aborted) { warnings.push(`已停止：第 ${i + 1}–${inputs.length} 项未提交。`); break }
        try { const result = await service.generate(sessionId, input, exec.signal, true); canvas = result.canvas; created.push(...result.items) }
        catch (error) { warnings.push(`第 ${i + 1} 项失败，未自动重试：${error instanceof Error ? error.message : '生成失败'}`) }
      }
      canvas ??= await service.store.get(sessionId)
      warnings.unshift(`批量生成：成功 ${created.length} / 共 ${inputs.length}。`)
      return { ...valueOf(service, canvas, created), warnings }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'seedream_canvas',
    description: 'List the images on the current conversation\'s PlotFig canvas with their item:<id> references, sizes, prompts and local paths. No API charge. Use before editing "the previous image" or an image the user referenced.',
    parameters: {}, output: { schema: OUTPUT, render: (_a, v) => render(v, false) }, isConcurrencySafe: () => true,
    async execute(_args, exec) { const sessionId = sessionOf(exec); return valueOf(service, await service.store.get(sessionId), []) },
  }))
  ctx.inject(['commands'], child => {
    const seen = new WeakMap<object, Set<string>>()
    child.commands.register({ name: 'seedream', description: 'PlotFig 画图 · 生成或修改图片，结果放到画布上',
      input: { hint: '画一张热带雨林垂直分层剖面图，教材插画风格', images: false },
      async handler(invocation) {
        const text = invocation.rawInput.trim()
        if (!text) return { kind: 'success', text: '用法：/seedream + 画面描述。例：/seedream 画一张热带雨林垂直分层剖面图，教材插画风格。生成的图片会放到右侧 PlotFig 画布，可在画布上继续编辑或引用。' }
        invocation.signal.throwIfAborted()
        const agent = invocation.agent, id = String(invocation.commandId)
        let receipts = seen.get(agent); if (!receipts) { receipts = new Set(); seen.set(agent, receipts) }
        if (receipts.has(id)) return { kind: 'success', text: '已加入当前对话。' }
        if (typeof agent.followup !== 'function') return { kind: 'error', text: '当前 Harness 不支持此命令。' }
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `/seedream ${text}` }] }))
        receipts.add(id); while (receipts.size > 128) receipts.delete(receipts.values().next().value!)
        return { kind: 'success', text: '已加入当前对话，将使用画布所选模型生成图片。' }
      },
    })
  })
}
