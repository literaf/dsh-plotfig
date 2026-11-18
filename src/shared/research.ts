/** Original presets for scientific illustrations. These describe appearance, not scientific facts. */
export const RESEARCH_STYLES = [
  { id: 'flat', name: '扁平示意', detail: '纯色块 · 清晰轮廓', use: '机制图、实验步骤与概念说明', prompt: '采用扁平二维科研示意风格：清晰的封闭轮廓、有限的纯色块、统一线宽、简化但可辨认的对象；不使用立体光照和厚重纹理。' },
  { id: '2.5d', name: '2.5D 层次', detail: '柔和阴影 · 适度纵深', use: '细胞、组织与层级结构', prompt: '采用具有适度纵深的二维科研插图风格：用柔和的局部渐变、轻微投影和遮挡表达层级；主体保持清晰，避免夸张透视和装饰光效。' },
  { id: '3d', name: '3D 立体', detail: '体积光照 · 材质区分', use: '仪器、材料与空间结构', prompt: '采用三维渲染观感的科研插图风格：以一致的透视、柔和光照和克制的材质差异表现体积；结构边界明确，背景干净，文字标注保持平面易读。' },
  { id: 'line-art', name: '黑白线稿', detail: '单色轮廓 · 结构优先', use: '工程结构与黑白印刷插图', prompt: '采用黑白科研线稿风格：白底、黑色或深灰轮廓、少量疏密线表达层次；以线型和位置区分对象，不依赖颜色，不添加大面积深色背景。' },
  { id: 'hand-drawn', name: '手绘插图', detail: '自然笔触 · 温和配色', use: '科研汇报、教学与科普', prompt: '采用自然手绘科研插图风格：有节制的手绘线条、柔和的淡彩填充和轻微纸面质感；对象结构与标注保持清楚，不让笔触遮挡重要细节。' },
  { id: 'journal', name: '简洁期刊', detail: '细线条 · 克制配色', use: '图形摘要与论文概念插图', prompt: '采用简洁的期刊插图视觉语言：白色背景、克制的蓝绿或中性色、统一细线条、充分留白、清晰的视觉层级；布局紧凑而不拥挤，避免装饰性渐变和大段文字。' },
] as const
export type ResearchStyleId = typeof RESEARCH_STYLES[number]['id']
export type GenerationStyle = 'auto' | ResearchStyleId
export const STYLE_IDS = ['auto', ...RESEARCH_STYLES.map(s => s.id)] as const
export function parseGenerationStyle(raw: unknown): GenerationStyle {
  if (typeof raw !== 'string' || !(STYLE_IDS as readonly string[]).includes(raw)) throw new Error('请选择有效的科研插图风格。')
  return raw as GenerationStyle
}
export const styleName = (id: GenerationStyle): string => RESEARCH_STYLES.find(s => s.id === id)?.name ?? '跟随描述'
export function styledPrompt(prompt: string, style: GenerationStyle): string {
  const preset = RESEARCH_STYLES.find(s => s.id === style)
  if (!preset) return prompt
  return `${prompt}\n\n视觉风格参考：${preset.name}\n${preset.prompt}\n风格只指导视觉呈现。严格遵循以上内容要求，保留指定的名称、数值、结构关系与箭头方向；不擅自添加结论或标注。用户明确要求保留的部分优先。`
}

export const RESEARCH_TOOLS = [
  { id: 'generate', title: '科研插图', description: '描述想法，选择风格，开始创作', hint: '从机制、实验步骤或研究方法开始描述。' },
  { id: 'decompose', title: '拆分图层', description: '把图片拆成可独立调整的元素', hint: '选择原图，再设置分层范围和最多输出数量。原图会保留。' },
  { id: 'text', title: '修改文字', description: '打开识别文字，调整内容与样式', hint: '已分层的画板可直接编辑。普通图片需要先分层识别，按实际输出图片数计费；识别后的改字在本地完成。' },
  { id: 'remove-background', title: '移除背景', description: '提取主体，保留透明背景', hint: '选择图片，再确认需要保留的对象。每次处理生成一张计费图片。' },
  { id: 'reference', title: '参考生图', description: '结合参考图片与新的内容要求', hint: '选择参考图，然后描述你的新内容与需要保留的特征。' },
  { id: 'sketch', title: '草图生图', description: '沿着草图结构完善科研插图', hint: '选择 PNG 或 JPEG 草图，再说明对象、关系和标注内容。' },
] as const
export type ResearchToolId = typeof RESEARCH_TOOLS[number]['id']
export const referencePrompt = (kind: 'reference' | 'sketch'): string => kind === 'sketch'
  ? '根据这张草图绘制科研插图，保留草图中明确的对象关系、箭头方向和布局。对模糊内容不要自行补写。具体内容与修改要求：'
  : '参考这张图片的视觉表达创作科研插图。具体内容、需要保留的特征与修改要求：'
