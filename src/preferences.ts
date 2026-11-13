import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isRecord, parseSize } from './shared/types.js'
export interface Prefs { size: string; watermark: boolean }
/** Workspace preferences changed from the settings card; plugin config supplies the initial values. */
export class Preferences {
  constructor(private readonly path: string, private readonly defaults: Prefs) {}
  async get(): Promise<Prefs> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      if (!isRecord(raw)) return { ...this.defaults }
      let size = this.defaults.size
      try { size = parseSize(raw.size, this.defaults.size) } catch { /* keep default */ }
      return { size, watermark: typeof raw.watermark === 'boolean' ? raw.watermark : this.defaults.watermark }
    } catch { return { ...this.defaults } }
  }
  async set(patch: Partial<Prefs>): Promise<Prefs> {
    const next = { ...await this.get(), ...patch }, temp = `${this.path}.${randomUUID()}.tmp`
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    try { await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temp, this.path) }
    finally { await rm(temp, { force: true }) }
    return next
  }
}
