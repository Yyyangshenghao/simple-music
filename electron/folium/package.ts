import { createHash, createPublicKey, verify } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import type { InstalledLyricMod } from '../../src/types/folium'

export const MARKET_ORIGIN = 'https://folium-compound.cielaniska.top'
export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024
const MAX_EXPANDED_BYTES = 24 * 1024 * 1024
export const MOD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

// Compatibility is tied to reviewed bytes. New market releases remain visible,
// but require another compatibility check before this host executes them.
export const COMPATIBLE_MODS: Record<string, { version: string; digest: string }> = {
  'sample-aurora-visualizer': { version: '1.0.1', digest: 'sha256:c150fae14af8213777fc5e528f096470d7e1bc654df0b16cb10ca5498d21b14f' },
  visualizer52hz: { version: '1.0.1', digest: 'sha256:a39803db7b3028adfb03dc10b2af3cb4d4da47f989c37965048049f38cf00447' },
  cinerama: { version: '1.0.0', digest: 'sha256:b0503a93d7051de8f740ccecb47a0568ea151039422dfe372b826706f7aa49ed' }
}

// Public Folium release signing keys. Beta keys are deliberately unsupported.
const KEYS: Record<string, string> = {
  'folium-2026-1': 'dDmFP2b-M1A-k9FBfXIBnvR6oLigIcdnzrT7f3y3qG8',
  'folium-ci-2026-1': 'GPmeaeLIYT85HunWM2xF1z62NeqmOh4BNpe4A2Xq5QI'
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function safeModPath(value: string): boolean {
  return !!value && value.length < 240 && !/[\\\x00-\x1f\x7f:%?#]/.test(value)
    && value.split('/').every(part => !!part && part !== '.' && part !== '..')
}

/** Reads bounded ZIP entries in memory; no paths from the archive reach disk. */
export function readModZip(archive: Buffer): Map<string, Buffer> {
  if (archive.length > MAX_ARCHIVE_BYTES || archive.length < 22) throw new Error('模组包大小不受支持')
  let end = archive.length - 22
  const floor = Math.max(0, archive.length - 65557)
  while (end >= floor && archive.readUInt32LE(end) !== 0x06054b50) end--
  if (end < floor || end + 22 + archive.readUInt16LE(end + 20) !== archive.length
    || archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0) throw new Error('模组 ZIP 格式无效')
  const count = archive.readUInt16LE(end + 10)
  const centralSize = archive.readUInt32LE(end + 12)
  let cursor = archive.readUInt32LE(end + 16)
  if (count > 512 || count === 0 || cursor + centralSize !== end
    || archive.readUInt16LE(end + 8) !== count) throw new Error('模组 ZIP 目录无效')
  const files = new Map<string, Buffer>()
  let total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('模组 ZIP 目录损坏')
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const compressed = archive.readUInt32LE(cursor + 20)
    const expanded = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const next = cursor + 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32)
    const local = archive.readUInt32LE(cursor + 42)
    const mode = archive.readUInt32LE(cursor + 38) >>> 16
    if (next > end || (flags & 1) || ![0, 8].includes(method) || (mode & 0xf000) === 0xa000
      || local + 30 > archive.length || archive.readUInt32LE(local) !== 0x04034b50) throw new Error('模组 ZIP 条目不受支持')
    const rawName = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    const directory = rawName.endsWith('/')
    const name = (directory ? rawName.slice(0, -1) : rawName).normalize('NFC')
    if (!safeModPath(name) || files.has(name)) throw new Error('模组含有不安全或重复的路径')
    const dataStart = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28)
    if (dataStart + compressed > archive.readUInt32LE(end + 16)) throw new Error('模组 ZIP 内容越界')
    if (!directory) {
      total += expanded
      if (expanded > MAX_ARCHIVE_BYTES || total > MAX_EXPANDED_BYTES) throw new Error('模组解压后过大')
      const bytes = archive.subarray(dataStart, dataStart + compressed)
      const data = method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: Math.max(1, expanded) })
      if (data.length !== expanded) throw new Error('模组 ZIP 长度不匹配')
      files.set(name, data)
    }
    cursor = next
  }
  if (cursor !== end) throw new Error('模组 ZIP 目录长度不匹配')
  const manifests = [...files.keys()].filter(name => /^[^/]+\/mod\.json$/.test(name))
  if (manifests.length !== 1) throw new Error('模组包必须只有一个顶层模组目录')
  const root = manifests[0].slice(0, -'mod.json'.length)
  if ([...files.keys()].some(name => !name.startsWith(root))) throw new Error('模组包含有目录外文件')
  return new Map([...files].map(([name, bytes]) => [name.slice(root.length), bytes]))
}

export interface VerifiedMod {
  info: InstalledLyricMod
  client: string
  files: Map<string, Buffer>
}

export function verifyModPackage(archive: Buffer, trust: {
  profiles?: typeof COMPATIBLE_MODS
  keys?: Record<string, string>
} = {}): VerifiedMod {
  const profiles = trust.profiles ?? COMPATIBLE_MODS
  const keys = trust.keys ?? KEYS
  const files = readModZip(archive)
  const parse = (path: string) => {
    const bytes = files.get(path)
    if (!bytes || bytes.length > 16384) throw new Error('模组缺少有效清单或签名')
    return JSON.parse(bytes.toString('utf8'))
  }
  const manifest = parse('mod.json')
  const signature = parse('folium.sig.json')
  const profile = Object.hasOwn(profiles, manifest.id) ? profiles[manifest.id] : undefined
  if (!profile || !MOD_ID.test(manifest.id) || manifest.folium !== 1 || manifest.main
    || typeof manifest.client !== 'string' || !safeModPath(manifest.client)
    || !/\.(mjs|js)$/.test(manifest.client) || !files.has(manifest.client)
    || manifest.version !== profile.version || (manifest.permissions?.length ?? 0) !== 0
    || (manifest.depends?.length ?? 0) !== 0
    || (manifest.experimental ?? []).some((key: string) => manifest.id !== 'visualizer52hz' || key !== 'ponder.targets')) throw new Error('此模组版本尚未通过兼容验证')
  const paths = [...files.keys()].filter(name => name !== 'folium.sig.json' && !['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(name.split('/').at(-1)!)).sort()
  const digest = 'sha256:' + sha256(paths.map(name => sha256(files.get(name)!) + ' ' + name + '\n').join(''))
  if (digest !== profile.digest || signature.digest !== digest
    || signature.format !== 'folium-signature' || signature.version !== 1
    || signature.modId !== manifest.id || signature.modVersion !== manifest.version
    || typeof signature.keyId !== 'string' || !Object.hasOwn(keys, signature.keyId)
    || typeof signature.signedAt !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(signature.signedAt)
    || typeof signature.signature !== 'string' || signature.signature.length > 128) throw new Error('模组签名或内容校验失败')
  const message = ['folium-signature/1', 'modId=' + signature.modId, 'modVersion=' + signature.modVersion,
    'digest=' + digest, 'keyId=' + signature.keyId, 'signedAt=' + signature.signedAt, ''].join('\n')
  const key = createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: keys[signature.keyId] } })
  if (!verify(null, Buffer.from(message), key, Buffer.from(signature.signature, 'base64'))) throw new Error('模组签名验证失败')
  return {
    client: manifest.client,
    files,
    info: {
      id: manifest.id, name: String(manifest.name ?? manifest.id).slice(0, 160), version: manifest.version,
      author: String(manifest.author ?? '').slice(0, 160), description: String(manifest.description ?? '').slice(0, 2000),
      preview: typeof manifest.preview === 'string' && safeModPath(manifest.preview) ? 'simplemusic-mod://' + manifest.id + '/' + manifest.preview : '',
      channel: 'release', compatible: true, reason: '', digest, valid: true
    }
  }
}
