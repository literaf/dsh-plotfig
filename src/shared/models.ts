/** Model keys and capabilities of the AI4Scholar drawing canvas and /api/proxy/nano/generate. */
export const MODEL = 'seedream55'
export const SIZE_TIERS = ['1K', '1.5K', '2K'] as const
const standardSizes = ['1K', '2K', '4K'] as const
export const DRAWING_MODELS = {
  seedream55: { label: 'Seedream 5.5', family: 'seedream', sizes: SIZE_TIERS },
  gpt26flare: { label: 'GPT Image 2.6 Flare', family: 'gpt', sizes: standardSizes },
  gpt26sunburst: { label: 'GPT Image 2.6 Sunburst', family: 'gpt', sizes: standardSizes },
  gptimage: { label: 'GPT Image 2', family: 'gpt', sizes: standardSizes },
  banana21: { label: 'Nano Banana 2.1', family: 'gemini', sizes: standardSizes },
  bananalite: { label: 'Nano Banana 2 Lite', family: 'gemini', sizes: ['1K'] },
  flash31: { label: 'Nano Banana 2', family: 'gemini', sizes: ['512px', ...standardSizes] },
  pro: { label: 'Nano Banana Pro', family: 'gemini', sizes: standardSizes },
  flash: { label: 'Nano Banana', family: 'gemini', sizes: ['1K'] },
} as const
export type DrawingModel = keyof typeof DRAWING_MODELS
export const MODEL_IDS = Object.keys(DRAWING_MODELS) as DrawingModel[]
export function parseDrawingModel(value: unknown): DrawingModel {
  if (typeof value !== 'string' || !Object.hasOwn(DRAWING_MODELS, value)) throw new Error('请选择列表中的绘图模型。')
  return value as DrawingModel
}
export const modelSizes = (model: DrawingModel): readonly string[] => DRAWING_MODELS[model].sizes
export function defaultModelSize(model: DrawingModel, preferred = '2K'): string {
  const sizes = modelSizes(model)
  if (sizes.includes(preferred)) return preferred
  return sizes.includes('2K') ? '2K' : sizes[0]!
}
const commonRatios = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '4:5', '5:4', '21:9'] as const
const extendedRatios = [...commonRatios, '1:4', '4:1', '1:8', '8:1'] as const
export type DrawingRatio = typeof extendedRatios[number]
export function modelRatios(model: DrawingModel): readonly DrawingRatio[] {
  return model === 'banana21' || model === 'flash31' ? extendedRatios : commonRatios
}
