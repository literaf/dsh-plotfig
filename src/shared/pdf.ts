/** zlib-format (RFC 1950) compression, as FlateDecode expects. */
export type Deflate = (bytes: Uint8Array) => Promise<Uint8Array>
export interface PdfImage { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

const ascii = (text: string) => new TextEncoder().encode(text)
/** PDF text strings: UTF-16BE with BOM, so Chinese titles survive in document properties. */
function pdfString(text: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0')
  return `<${hex}>`
}
const pdfDate = (d: Date) => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`

/**
 * A single-page PDF holding the artboard as one lossless image. The page is sized
 * at 72 ppi, matching the PSD export, so 1 px equals 1 pt. Alpha becomes an SMask.
 */
export async function buildPdf(image: PdfImage, title: string, deflate: Deflate, created = new Date()): Promise<Uint8Array> {
  const { width, height, data } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) throw new Error('PDF 图像尺寸与数据不一致。')
  if (width > 14400 || height > 14400) throw new Error('PDF 页面每边不能超过 14400 像素。')
  const rgb = new Uint8Array(width * height * 3), alpha = new Uint8Array(width * height)
  let transparent = false
  for (let p = 0; p < width * height; p++) {
    rgb[p * 3] = data[p * 4]!; rgb[p * 3 + 1] = data[p * 4 + 1]!; rgb[p * 3 + 2] = data[p * 4 + 2]!
    alpha[p] = data[p * 4 + 3]!
    if (alpha[p]! < 255) transparent = true
  }
  const [color, mask] = await Promise.all([deflate(rgb), transparent ? deflate(alpha) : undefined])
  const content = ascii(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`)
  const objects: Array<Array<string | Uint8Array>> = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`],
    [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${mask ? ' /SMask 7 0 R' : ''} /Length ${color.length} >>\nstream\n`, color, '\nendstream'],
    [`<< /Length ${content.length} >>\nstream\n`, content, 'endstream'],
    [`<< /Title ${pdfString(title)} /Producer (dsh-seedream) /CreationDate (${pdfDate(created)}) >>`],
    ...(mask ? [[`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mask.length} >>\nstream\n`, mask, '\nendstream']] : []),
  ]
  const chunks: Uint8Array[] = [ascii('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')], offsets: number[] = []
  let length = chunks[0]!.length
  const push = (part: string | Uint8Array) => { const bytes = typeof part === 'string' ? ascii(part) : part; chunks.push(bytes); length += bytes.length }
  for (const [index, parts] of objects.entries()) {
    offsets.push(length)
    push(`${index + 1} 0 obj\n`); parts.forEach(push); push('\nendobj\n')
  }
  const xref = length
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`)
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(length)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}
