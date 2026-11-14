export interface MaskMark {
  kind: 'brush' | 'rect'
  subtract: boolean
  points: number[]
  size: number
}
/** White is editable, transparent/black is preserved. The model never receives this as an undocumented mask parameter. */
export function maskPng(width: number, height: number, marks: MaskMark[]): string {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建消除选区。')
  for (const mark of marks) {
    context.globalCompositeOperation = mark.subtract ? 'destination-out' : 'source-over'
    context.fillStyle = '#ffffff'; context.strokeStyle = '#ffffff'; context.lineWidth = mark.size; context.lineCap = 'round'; context.lineJoin = 'round'
    const [x, y] = mark.points
    if (x === undefined || y === undefined) continue
    if (mark.kind === 'rect') {
      const x2 = mark.points[2] ?? x, y2 = mark.points[3] ?? y
      context.fillRect(Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y))
    } else if (mark.points.length === 2) { context.beginPath(); context.arc(x, y, mark.size / 2, 0, Math.PI * 2); context.fill() }
    else { context.beginPath(); context.moveTo(x, y); for (let i = 2; i < mark.points.length; i += 2) context.lineTo(mark.points[i]!, mark.points[i + 1]!); context.stroke() }
  }
  return canvas.toDataURL('image/png')
}
