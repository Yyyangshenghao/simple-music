import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { InstalledLyricMod, LyricModCatalog } from '../../src/types/folium'
import { COMPATIBLE_MODS, MARKET_ORIGIN, MAX_ARCHIVE_BYTES, MOD_ID, sha256, verifyModPackage, type VerifiedMod } from './package'

interface MarketEntry {
  id: string
  name: string
  version: string
  digest: string
  author?: string
  description?: string
  channel?: string
  hasMain?: boolean
  download: { url: string; size: number; sha256: string }
  preview?: { url: string }
}

export function marketUrl(value: string, folder: 'downloads' | 'previews'): string {
  const url = new URL(value, MARKET_ORIGIN)
  if (url.origin !== MARKET_ORIGIN || url.username || url.password || url.search || url.hash
    || !new RegExp('^/' + folder + '/[a-zA-Z0-9._-]+$').test(url.pathname)) throw new Error('市场资源地址无效')
  return url.href
}

async function readResponse(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error('模组市场暂时无法连接，请重试')
  if (Number(response.headers.get('content-length')) > limit) throw new Error('市场资源超出大小限制')
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new Error('市场资源超出大小限制')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks)
}

export class LyricModManager {
  private catalog?: { at: number; entries: MarketEntry[] }
  private catalogRequest?: Promise<MarketEntry[]>
  private mutation: Promise<unknown> = Promise.resolve()
  private cache = new Map<string, VerifiedMod>()
  private epoch = 0

  constructor(private directory: string, private request: typeof fetch = fetch) {}

  private async download(url: string, limit: number): Promise<Buffer> {
    const response = await this.request(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20000) })
    return readResponse(response, limit)
  }

  private async entries(): Promise<MarketEntry[]> {
    if (this.catalog && Date.now() - this.catalog.at < 60000) return this.catalog.entries
    if (this.catalogRequest) return this.catalogRequest
    this.catalogRequest = (async () => {
      const bytes = await this.download(MARKET_ORIGIN + '/catalog.json', 1024 * 1024)
      const value = JSON.parse(bytes.toString('utf8'))
      if (value.format !== 'folium-market-catalog' || value.version !== 2 || !Array.isArray(value.mods)
        || value.mods.length > 200) throw new Error('模组市场目录版本不受支持')
      const ids = new Set<string>()
      const entries: MarketEntry[] = value.mods.filter((item: MarketEntry) => {
        if (!item || !MOD_ID.test(item.id) || ids.has(item.id) || typeof item.name !== 'string'
          || typeof item.version !== 'string' || typeof item.digest !== 'string' || !item.download
          || !Number.isSafeInteger(item.download.size) || item.download.size <= 0 || item.download.size > MAX_ARCHIVE_BYTES
          || !/^[a-f0-9]{64}$/.test(item.download.sha256)) return false
        try { marketUrl(item.download.url, 'downloads'); if (item.preview) marketUrl(item.preview.url, 'previews') } catch { return false }
        ids.add(item.id)
        return true
      })
      this.catalog = { entries, at: Date.now() }
      return entries
    })().finally(() => { this.catalogRequest = undefined })
    return this.catalogRequest
  }

  async getCatalog(): Promise<LyricModCatalog> {
    return { mods: (await this.entries()).map(item => {
      const profile = COMPATIBLE_MODS[item.id]
      const compatible = !!profile && profile.version === item.version && profile.digest === item.digest && item.channel === 'release' && !item.hasMain
      return {
        id: item.id, name: item.name.slice(0, 160), version: item.version.slice(0, 64),
        author: String(item.author ?? '').slice(0, 160), description: String(item.description ?? '').slice(0, 2000),
        preview: item.preview ? marketUrl(item.preview.url, 'previews') : '',
        channel: item.channel === 'beta' ? 'beta' : 'release', compatible, digest: item.digest,
        reason: compatible ? '' : item.channel === 'beta' ? '先行测试模组暂不支持'
          : profile ? '新版本尚未通过兼容验证' : item.hasMain ? '需要主进程扩展，暂不支持' : '尚未适配此模组的宿主能力'
      }
    }) }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation)
    this.mutation = result.catch(() => {})
    return result
  }

  async list(): Promise<InstalledLyricMod[]> {
    await this.mutation
    const names = await fs.readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const mods: InstalledLyricMod[] = []
    for (const name of names.filter(name => name.endsWith('.zip') && MOD_ID.test(name.slice(0, -4))).slice(0, 50)) {
      const id = name.slice(0, -4)
      try { mods.push((await this.read(id)).info) }
      catch {
        this.cache.delete(id)
        mods.push({ id, name: id, version: '', author: '', description: '', preview: '', channel: 'release', compatible: false, valid: false, digest: '', reason: '文件校验失败，请卸载后重新安装' })
      }
    }
    return mods
  }

  private async read(id: string): Promise<VerifiedMod> {
    if (typeof id !== 'string' || !MOD_ID.test(id)) throw new Error('模组标识无效')
    const file = join(this.directory, id + '.zip')
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) throw new Error('模组文件无效')
    const mod = verifyModPackage(await fs.readFile(file))
    if (mod.info.id !== id) throw new Error('模组标识不匹配')
    return mod
  }

  async load(id: string): Promise<VerifiedMod> {
    if (typeof id !== 'string' || !MOD_ID.test(id)) throw new Error('模组标识无效')
    // 不等待安装/卸载的串行锁：安装可能要下载十几秒，正在使用的模组不能因此启动超时。
    // 安装以原子 rename 落盘，读到的总是完整文件；期间状态变化由 epoch 丢弃。
    const epoch = this.epoch
    const cached = this.cache.get(id)
    if (cached) return cached
    const mod = await this.read(id)
    if (epoch !== this.epoch) throw new Error('模组状态已改变')
    if (this.cache.size >= 3) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(id, mod)
    return mod
  }

  install(id: string): Promise<void> {
    return this.serial(async () => {
      if (typeof id !== 'string' || !MOD_ID.test(id)) throw new Error('模组标识无效')
      const supported = (await this.getCatalog()).mods.find(mod => mod.id === id && mod.compatible)
      const entry = (await this.entries()).find(mod => mod.id === id)
      if (!supported || !entry) throw new Error('此模组尚未通过兼容验证')
      const bytes = await this.download(marketUrl(entry.download.url, 'downloads'), MAX_ARCHIVE_BYTES)
      if (bytes.length !== entry.download.size || sha256(bytes) !== entry.download.sha256) throw new Error('模组下载校验失败，请重试')
      const mod = verifyModPackage(bytes)
      if (mod.info.id !== id || mod.info.digest !== entry.digest) throw new Error('模组内容与市场目录不符')
      await fs.mkdir(this.directory, { recursive: true })
      const temporary = join(this.directory, '.' + id + '-' + randomUUID() + '.tmp')
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
        await fs.rename(temporary, join(this.directory, id + '.zip'))
        this.epoch++
        this.cache.delete(id)
      } finally { await fs.rm(temporary, { force: true }) }
    })
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      if (typeof id !== 'string' || !MOD_ID.test(id)) throw new Error('模组标识无效')
      await fs.rm(join(this.directory, id + '.zip'), { force: true })
      this.epoch++
      this.cache.delete(id)
    })
  }
}
