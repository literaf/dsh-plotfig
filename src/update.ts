import { createRequire } from 'node:module'
import { isRecord } from './shared/types.js'
import type { PluginUpdate } from './shared/types.js'

export const VERSION: string = createRequire(import.meta.url)('../package.json').version
const REGISTRY_URL = 'https://registry.npmjs.org/dsh-plotfig/latest'
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/

function parseRelease(value: string) {
  const match = value.length <= 256 ? SEMVER.exec(value) : null
  if (!match) throw new Error('Invalid release version')
  const core = match.slice(1, 4).map(Number)
  if (!core.every(Number.isSafeInteger) || match[4]?.split('.').some(part => /^0\d+$/.test(part))) {
    throw new Error('Invalid release version')
  }
  return { core, prerelease: match[4] !== undefined }
}

export function compareStableRelease(currentVersion: string, latestVersion: string): PluginUpdate['status'] {
  const current = parseRelease(currentVersion), latest = parseRelease(latestVersion)
  if (latest.prerelease) throw new Error('Expected a stable release')
  for (let i = 0; i < current.core.length; i++) {
    if (current.core[i]! < latest.core[i]!) return 'available'
    if (current.core[i]! > latest.core[i]!) return 'ahead'
  }
  return current.prerelease ? 'available' : 'current'
}

export async function checkForUpdate(signal: AbortSignal): Promise<PluginUpdate> {
  const response = await fetch(REGISTRY_URL, {
    headers: { Accept: 'application/json' }, cache: 'no-store', redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  })
  if (!response.ok) throw new Error('Registry request failed')
  const data: unknown = await response.json()
  if (!isRecord(data) || data.name !== 'dsh-plotfig' || typeof data.version !== 'string') {
    throw new Error('Invalid registry response')
  }
  return { currentVersion: VERSION, latestVersion: data.version, status: compareStableRelease(VERSION, data.version) }
}
