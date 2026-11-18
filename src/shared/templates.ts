import type { CanvasLayer, Composition, ConnectorBinding } from './types.js'
import { updateConnectors } from './diagram.js'

export const TEMPLATE_CATEGORIES = ['全部', '流程图', '模型架构', '循环图', '时间线'] as const
export const DIAGRAM_TEMPLATES = [
  { id: 'experiment', name: '实验流程', category: '流程图', detail: '准备、处理、测量与分析' },
  { id: 'screening', name: '筛选与判断', category: '流程图', detail: '分支判断与纳入流程' },
  { id: 'encoder-decoder', name: '编码器与解码器', category: '模型架构', detail: '输入、表征与输出模块' },
  { id: 'multi-input', name: '多路特征融合', category: '模型架构', detail: '双路输入与融合预测' },
  { id: 'research-cycle', name: '研究迭代', category: '循环图', detail: '提出、验证、分析与改进' },
  { id: 'feedback', name: '反馈闭环', category: '循环图', detail: '执行、评估与反馈' },
  { id: 'research-plan', name: '研究计划', category: '时间线', detail: '四个阶段与交付内容' },
  { id: 'milestones', name: '里程碑', category: '时间线', detail: '关键节点与阶段成果' },
] as const
export type TemplateId = typeof DIAGRAM_TEMPLATES[number]['id']
export const DIAGRAM_PALETTES = [
  { id: 'ocean', name: '蓝绿', fill: '#e7f2f5', accent: '#e6f3eb', stroke: '#507b8b', ink: '#253748' },
  { id: 'mono', name: '黑白', fill: '#ffffff', accent: '#f0f1f2', stroke: '#555b64', ink: '#242830' },
  { id: 'warm', name: '暖色', fill: '#fcf0df', accent: '#f6e6e3', stroke: '#a47c58', ink: '#4e3d32' },
] as const
export type DiagramPalette = typeof DIAGRAM_PALETTES[number]['id']
const FONT = 'Arial, PingFang SC, Microsoft YaHei, sans-serif'
/** Original local templates. Content is illustrative and remains editable. */
export function createDiagramTemplate(id: string, palette = 'ocean'): Pick<Composition, 'title' | 'width' | 'height' | 'background' | 'layers'> {
  const template = DIAGRAM_TEMPLATES.find(t => t.id === id), p = DIAGRAM_PALETTES.find(p => p.id === palette)
  if (!template || !p) throw new Error('请选择有效的模板与配色。')
  const layers: CanvasLayer[] = [], links: CanvasLayer[] = []
  const base = (id: string, x: number, y: number, width: number, height: number): CanvasLayer => ({ id, kind: 'rect', name: id, x, y, width, height, rotation: 0, opacity: 1, hidden: false, locked: false })
  const node = (id: string, text: string, x: number, y: number, width = 220, height = 100, kind: 'rect' | 'ellipse' | 'diamond' = 'rect', accent = false) => {
    layers.push({ ...base(id, x, y, width, height), kind, name: text.replace(/\n/g, ' · '), text, fontSize: 27, fontFamily: FONT, bold: false, italic: false, align: 'center', textColor: p.ink, fill: accent ? p.accent : p.fill, stroke: p.stroke, strokeWidth: 2, cornerRadius: 16 })
  }
  const text = (id: string, value: string, x: number, y: number, width: number, size = 22, align: 'left' | 'center' = 'center') => {
    layers.push({ ...base(id, x, y, width, size * 2.5), kind: 'text', name: value, text: value, fontSize: size, fontFamily: FONT, bold: id === 'title', italic: false, align, fill: p.ink })
  }
  const link = (from: string, to: string, start: ConnectorBinding['side'] = 'right', end: ConnectorBinding['side'] = 'left', routing: CanvasLayer['routing'] = 'straight') => {
    links.push({ ...base(`link-${links.length}`, 0, 0, 20, 20), kind: 'arrow', name: `${from} → ${to}`, fill: p.stroke, stroke: p.stroke, strokeWidth: 3, points: [0, 0.5, 1, 0.5], startBinding: { layerId: from, side: start }, endBinding: { layerId: to, side: end }, routing })
  }
  text('title', template.name, 64, 52, 1072, 38, 'left')
  if (id === 'experiment') {
    ;['样本准备', '实验处理', '数据测量', '结果分析'].forEach((t, i) => { node(`n${i}`, t, 65 + i * 290, 300); text(`s${i}`, `0${i + 1}`, 65 + i * 290, 235, 220, 21); if (i) link(`n${i - 1}`, `n${i}`) })
  } else if (id === 'screening') {
    node('input', '候选材料', 380, 160, 260, 78)
    node('decision', '符合条件？', 375, 300, 270, 150, 'diamond')
    node('include', '纳入分析', 380, 530, 260, 85, 'rect', true)
    node('exclude', '排除 / 补充', 840, 330, 260, 90)
    link('input', 'decision', 'bottom', 'top'); link('decision', 'include', 'bottom', 'top'); link('decision', 'exclude')
    text('yes', '是', 530, 465, 80, 22); text('no', '否', 700, 330, 80, 22)
  } else if (id === 'encoder-decoder') {
    node('input', '输入', 55, 310, 170, 100); node('encoder', '编码器', 300, 260, 220, 200)
    node('latent', '潜在表征', 595, 310, 180, 100, 'ellipse', true); node('decoder', '解码器', 850, 260, 220, 200)
    link('input', 'encoder'); link('encoder', 'latent'); link('latent', 'decoder')
    text('output', '输出 / 重建结果', 820, 505, 280, 24)
    text('input-note', '数据或特征', 40, 450, 200, 21)
  } else if (id === 'multi-input') {
    node('a', '输入 A', 70, 205, 190, 90); node('b', '输入 B', 70, 465, 190, 90)
    node('fa', '特征提取 A', 345, 205, 220, 90); node('fb', '特征提取 B', 345, 465, 220, 90)
    node('fusion', '特征融合', 700, 330, 200, 100, 'rect', true); node('out', '预测', 1000, 330, 150, 100)
    link('a', 'fa'); link('b', 'fb'); link('fa', 'fusion', 'right', 'top', 'horizontal'); link('fb', 'fusion', 'right', 'bottom', 'horizontal'); link('fusion', 'out')
  } else if (id === 'research-cycle') {
    node('question', '提出问题', 450, 155, 300, 95); node('test', '设计与验证', 850, 345, 270, 95)
    node('analysis', '整理与分析', 450, 545, 300, 95); node('improve', '修正与改进', 80, 345, 270, 95)
    link('question', 'test', 'right', 'top', 'horizontal'); link('test', 'analysis', 'bottom', 'right', 'vertical')
    link('analysis', 'improve', 'left', 'bottom', 'horizontal'); link('improve', 'question', 'top', 'left', 'vertical')
    text('center', '持续迭代', 450, 365, 300, 30)
  } else if (id === 'feedback') {
    node('plan', '设定目标', 70, 260, 250, 110); node('act', '执行过程', 475, 260, 250, 110)
    node('check', '结果评估', 880, 260, 250, 110); node('feedback', '反馈与调整', 475, 530, 250, 95, 'rect', true)
    link('plan', 'act'); link('act', 'check'); link('check', 'feedback', 'bottom', 'right', 'vertical'); link('feedback', 'plan', 'left', 'bottom', 'horizontal')
  } else if (id === 'research-plan') {
    ;[['阶段一', '研究设计'], ['阶段二', '采集数据'], ['阶段三', '分析验证'], ['阶段四', '总结交付']].forEach(([s, t], i) => {
      node(`n${i}`, `${s}\n${t}`, 55 + i * 295, 300, 210, 140, 'rect', i % 2 === 1)
      text(`date${i}`, `第 ${i + 1} 阶段`, 55 + i * 295, 225, 210, 22)
      if (i) link(`n${i - 1}`, `n${i}`)
    })
  } else {
    ;['项目启动', '初步成果', '验证完成', '成果交付'].forEach((t, i) => {
      node(`n${i}`, `${i + 1}`, 120 + i * 295, 335, 72, 72, 'ellipse', true)
      text(`event${i}`, t, 50 + i * 295, i % 2 ? 460 : 225, 215, 26)
      text(`date${i}`, '填写日期', 50 + i * 295, i % 2 ? 510 : 275, 215, 20)
      if (i) link(`n${i - 1}`, `n${i}`)
    })
  }
  for (const link of links) { const from = layers.find(l => l.id === link.startBinding?.layerId), to = layers.find(l => l.id === link.endBinding?.layerId); link.name = `${from?.name ?? '节点'} → ${to?.name ?? '节点'}` }
  return { title: template.name, width: 1200, height: 760, background: '#ffffff', layers: updateConnectors([...links, ...layers]) }
}
