import { useEffect, useState } from 'react'

const cache = new Map<string, Promise<HTMLImageElement>>()
export function loadImage(src: string): Promise<HTMLImageElement> {
  let pending = cache.get(src)
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image(), timer = setTimeout(() => { image.src = ''; reject(new Error('图片加载超时，请稍后重试。')) }, 30000)
      image.onload = () => { clearTimeout(timer); resolve(image) }
      image.onerror = () => { clearTimeout(timer); reject(new Error('图层图片加载失败。')) }
      image.decoding = 'async'; image.src = src
    })
    cache.set(src, pending)
    void pending.catch(() => cache.delete(src))
    while (cache.size > 100) cache.delete(cache.keys().next().value!)
  }
  return pending
}
export function useImage(src: string | undefined): HTMLImageElement | undefined {
  const [image, setImage] = useState<HTMLImageElement>()
  useEffect(() => {
    let active = true; setImage(undefined)
    if (src) void loadImage(src).then(img => { if (active) setImage(img) }).catch(() => {})
    return () => { active = false }
  }, [src])
  return image
}
