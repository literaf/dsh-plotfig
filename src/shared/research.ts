/** Appearance presets; content, figure type, view and palette remain independent. */
export const RESEARCH_STYLES = [
  {
    "id": "flat",
    "name": "二维扁平",
    "detail": "纯色块 · 统一轮廓",
    "use": "机制概念、实验步骤和模块关系",
    "prompt": "采用二维扁平科研示意风格：简化但可辨认的封闭轮廓、有限的纯色块、统一细线宽；所有色块保持平涂。不要渐变、立体光照、阴影、反光、厚重纹理或纸面笔触。",
    "definition": "以简化的封闭形状和有限纯色表现对象，不依赖明暗来表现体积。",
    "rules": {
      "shape": "简化但保留识别结构",
      "outline": "平滑、统一线宽",
      "fill": "纯色块",
      "shading": "不使用渐变、体积光或投影",
      "texture": "无表面纹理",
      "background": "白色或透明",
      "annotation": "统一平面文字与线条"
    },
    "avoid": [
      "真实反光",
      "体积阴影",
      "复杂纹理",
      "纸面笔触"
    ]
  },
  {
    "id": "2.5d",
    "name": "柔和立体",
    "detail": "轻微渐变 · 克制纵深",
    "use": "对象结构、空间层次和科研组件",
    "prompt": "采用柔和立体科研图解风格（2.5D）：保留简化而清晰的造型和统一细轮廓，使用少量柔和局部渐变、遮挡和轻微阴影提示体积；表面平滑、细节克制。不要写实摄影、强反光、金属高光、装饰光晕或厚重纹理。",
    "definition": "保持简化图解造型，以少量渐变、遮挡和柔和阴影提供体积提示。",
    "rules": {
      "shape": "简化图解造型",
      "outline": "清楚、细且一致",
      "fill": "有限色彩与局部渐变",
      "shading": "柔和局部阴影、轻微投影",
      "texture": "光滑，少细节",
      "background": "白色或透明",
      "annotation": "平面标注，不随透视变形"
    },
    "avoid": [
      "强反射",
      "摄影质感",
      "装饰光晕",
      "密集纹理"
    ]
  },
  {
    "id": "line-art",
    "name": "清晰线稿",
    "detail": "轮廓与线型 · 少量填充",
    "use": "结构说明、简洁组件和单色输出",
    "prompt": "采用清晰线稿风格：以黑色或深灰色的统一轮廓线和少量结构线表现对象，内部以白色留白为主；保持轮廓闭合且可辨认。不要大面积彩色填充、渐变、三维光照、摄影纹理或密集装饰排线。",
    "definition": "主要依靠轮廓、线型和必要的少量排线区分对象与结构。",
    "rules": {
      "shape": "准确、可辨认的结构轮廓",
      "outline": "清晰、统一；粗细作为独立参数",
      "fill": "留白为主",
      "shading": "仅必要的少量排线",
      "texture": "不使用纸面或照片纹理",
      "background": "白色或透明",
      "annotation": "与主体线宽协调"
    },
    "avoid": [
      "大面积彩色填充",
      "渐变",
      "三维光照",
      "密集艺术排线"
    ]
  },
  {
    "id": "naturalistic",
    "name": "自然写实插画",
    "detail": "可信形态 · 绘画式明暗",
    "use": "自然形态、组织与实物的解释性插画",
    "prompt": "采用自然写实的数字教材插画风格：保留可信的物体比例与适量结构细节，用细腻平滑的绘画式明暗表现曲面，边缘清楚，材料观感克制。它是一幅精细插画，不是摄影或产品宣传渲染。不要夸张卡通、涂鸦线、纸面颗粒、景深虚化或夸张玻璃质感。",
    "definition": "以绘画方式保留物体的自然比例和细节，明暗平滑，整体呈现教材插画观感。",
    "rules": {
      "shape": "自然比例、适量细节",
      "outline": "细轮廓或由色块边界形成",
      "fill": "接近自然物体的分区色",
      "shading": "连续、平滑的绘画式明暗",
      "texture": "细腻克制，非摄影噪点",
      "background": "干净白底",
      "annotation": "独立平面标签与引线"
    },
    "avoid": [
      "夸张卡通比例",
      "明显涂鸦",
      "大面积纸纹",
      "摄影景深",
      "玻璃化所有材料"
    ]
  },
  {
    "id": "3d",
    "name": "三维渲染",
    "detail": "体积光照 · 材质区分",
    "use": "材料、装置和空间结构概念",
    "prompt": "采用三维渲染观感的科研插图风格：明确而连贯的物体体积、统一柔和棚光、真实的表面高光与接触阴影，使用克制的材质区分。结构边界清晰，干净白底，不使用景深虚化或镜头特效；不得改变规定的视角和部件数量。",
    "definition": "以一致光照、明确体积和材质差异形成三维渲染观感。",
    "rules": {
      "shape": "具有连贯的三维体积",
      "outline": "以体积边界为主",
      "fill": "遵循材质的表面色",
      "shading": "一致的光照、高光和接触阴影",
      "texture": "按任务选择材料属性",
      "background": "白色或透明",
      "annotation": "标签保持平面易读"
    },
    "avoid": [
      "不一致透视",
      "无关镜头特效",
      "文字随物体扭曲",
      "凭材质臆造内部结构"
    ]
  },
  {
    "id": "hand-drawn",
    "name": "手绘淡彩",
    "detail": "自然墨线 · 轻淡色洗",
    "use": "解释性插图、教学与科学传播",
    "prompt": "采用手绘淡彩科研插画风格：自然墨线轮廓带少量手绘变化，稀薄淡彩色洗，局部轻微排线，白色纸面仅保留很轻的纸感。结构和主体保持清楚。不要凌乱速写、厚重纸纹、强烈三维高光或遮盖结构的笔触。",
    "definition": "可见自然笔触与淡彩色洗，允许轻微纸感，但保留清楚的主体和结构。",
    "rules": {
      "shape": "可辨认的真实结构，适度简化",
      "outline": "自然墨线，轻微手绘变化",
      "fill": "稀薄淡彩色洗",
      "shading": "少量手绘阴影或排线",
      "texture": "轻微纸感",
      "background": "白色纸面",
      "annotation": "规整文字，不让笔触影响可读性"
    },
    "avoid": [
      "凌乱速写",
      "浓重纸纹",
      "强烈三维反射",
      "结构被笔触遮挡"
    ]
  }
] as const
export type ResearchStyleId = typeof RESEARCH_STYLES[number]['id']
/** Existing saved canvases keep their original prompt instead of being silently remapped. */
const LEGACY_JOURNAL_STYLE = { id: 'journal', name: '简洁期刊', detail: '细线条 · 克制配色', use: '图形摘要与论文概念插图', prompt: '采用简洁的期刊插图视觉语言：白色背景、克制的蓝绿或中性色、统一细线条、充分留白、清晰的视觉层级；布局紧凑而不拥挤，避免装饰性渐变和大段文字。' } as const
export type GenerationStyle = 'auto' | ResearchStyleId | 'journal'
export const STYLE_IDS = ['auto', ...RESEARCH_STYLES.map(s => s.id), 'journal'] as const
export function parseGenerationStyle(raw: unknown): GenerationStyle {
  if (typeof raw !== 'string' || !(STYLE_IDS as readonly string[]).includes(raw)) throw new Error('请选择有效的科研插图风格。')
  return raw as GenerationStyle
}
function resolveStyle(id: GenerationStyle) {
  return id === 'journal' ? LEGACY_JOURNAL_STYLE : RESEARCH_STYLES.find(s => s.id === id)
}
export const styleName = (id: GenerationStyle): string => id === 'journal' ? '简洁期刊（旧预设）' : resolveStyle(id)?.name ?? '跟随描述'
export function styledPrompt(prompt: string, style: GenerationStyle): string {
  const preset = resolveStyle(style)
  if (!preset) return prompt
  return `${prompt}\n\n视觉风格参考：${preset.name}\n${preset.prompt}\n风格只指导视觉呈现。严格遵循以上内容要求，保留指定的名称、数值、结构关系与箭头方向；不擅自添加结论或标注。用户明确要求保留的部分优先。`
}

export const RESEARCH_TOOLS = [
  { id: 'generate', title: '科研插图', description: '描述想法，选择风格，开始创作', hint: '从机制、实验步骤或研究方法开始描述。' },
  { id: 'decompose', title: '拆分图层', description: '把图片拆成可独立调整的元素', hint: '选择原图，再设置分层范围和最多输出数量。原图会保留。' },
  { id: 'text', title: '修改文字', description: '打开识别文字，调整内容与样式', hint: '已分层的画板可直接改字。普通图片需要先分层识别，提交前请确认本次分层所需的 AI4Scholar 积分。识别后的改字在本地完成。' },
  { id: 'remove-background', title: '移除背景', description: '提取主体，保留透明背景', hint: '选择图片，再确认需要保留的对象。每次处理生成一张计费图片。' },
  { id: 'reference', title: '参考生图', description: '结合参考图片与新的内容要求', hint: '选择参考图，然后描述你的新内容与需要保留的特征。' },
  { id: 'sketch', title: '草图生图', description: '沿着草图结构完善科研插图', hint: '选择 PNG 或 JPEG 草图，再说明对象、关系和标注内容。' },
] as const
export type ResearchToolId = typeof RESEARCH_TOOLS[number]['id']
export const referencePrompt = (kind: 'reference' | 'sketch'): string => kind === 'sketch'
  ? '根据这张草图绘制科研插图，保留草图中明确的对象关系、箭头方向和布局。对模糊内容不要自行补写。具体内容与修改要求：'
  : '参考这张图片的视觉表达创作科研插图。具体内容、需要保留的特征与修改要求：'
