/** Minimal PNG header with the given IHDR dimensions. */
export function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33), v = new DataView(b.buffer)
  v.setUint32(0, 0x89504e47); v.setUint32(4, 0x0d0a1a0a); v.setUint32(8, 13); v.setUint32(12, 0x49484452); v.setUint32(16, width); v.setUint32(20, height)
  return b
}

export function drawingQuote(maxImages: number, generationConfigured = true) {
  return { version: 1, model: 'seedream55', enabled: true, generationConfigured, maxImages, supportedMaxImages: 100, creditCost: 41 }
}

/** Simulate a generation, its free checks, and the separate image download. */
export function drawingFetch(onGenerate: (body: Record<string, unknown>) => void | Response | Promise<void | Response>, image = png(1024, 1024)): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input))
    if (url.href === 'https://cdn.example/result.png') return new Response(image)
    if (url.origin !== 'https://ai4scholar.net') throw new Error(`Unexpected origin ${url.origin}`)
    if (url.pathname === '/api/credits' && init?.method === 'GET') return Response.json({ credits: { total_available: 75 } })
    if (url.pathname === '/api/proxy/nano/layers' && init?.method === 'GET') return Response.json(drawingQuote(Number(url.searchParams.get('maxImages'))))
    if (url.pathname === '/api/proxy/nano/generate' && init?.method === 'POST') {
      const result = await onGenerate(JSON.parse(String(init.body)))
      return result ?? Response.json({ success: true, imageUrl: 'https://cdn.example/result.png' })
    }
    throw new Error(`Unexpected drawing request ${init?.method} ${url.pathname}`)
  }
}
