import { afterEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./package', async original => {
  const actual = await original<typeof import('./package')>()
  return { ...actual, verifyModPackage: vi.fn((bytes: Buffer) => {
    if (bytes.toString() !== 'verified package') throw new Error('签名校验失败')
    return { client: 'client.mjs', files: new Map(), info: { id: 'cinerama', name: '巨幕', version: '1.0.0', valid: true, digest: actual.COMPATIBLE_MODS.cinerama.digest } }
  }) }
})
import { LyricModManager, marketUrl } from './manager'
import { COMPATIBLE_MODS, sha256 } from './package'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'folium-manager-'))
  directories.push(directory)
  let corrupted = false
  const bytes = Buffer.from('verified package')
  const entry = { id: 'cinerama', name: '巨幕', version: '1.0.0', digest: COMPATIBLE_MODS.cinerama.digest, channel: 'release', hasMain: false,
    download: { url: '/downloads/cinerama-1.0.0.zip', size: bytes.length, sha256: sha256(bytes) } }
  const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    expect(options?.redirect).toBe('error')
    expect(options?.credentials).toBe('omit')
    if (String(url).endsWith('catalog.json')) return new Response(JSON.stringify({ format: 'folium-market-catalog', version: 2, mods: [entry,
      { ...entry, id: 'unsupported', hasMain: true }, { ...entry, id: 'beta', channel: 'beta' }] }))
    return new Response(corrupted ? 'corrupt' : bytes)
  }) as typeof fetch
  return { directory, manager: new LyricModManager(directory, request), corrupt: () => { corrupted = true }, request }
}

describe('歌词模组安装与离线恢复', () => {
  it('完整市场可浏览，但只有本地验证的正式视觉包可安装', async () => {
    const { manager } = await fixture()
    const { mods } = await manager.getCatalog()
    expect(mods.map(mod => mod.compatible)).toEqual([true, false, false])
    expect(mods[1].reason).toContain('主进程')
    await expect(manager.install('unsupported')).rejects.toThrow('尚未通过兼容')
    await expect(manager.remove('../escape')).rejects.toThrow('标识无效')
  })
  it('下载校验后原子安装；失败更新保留上一份原包', async () => {
    const { manager, directory, corrupt } = await fixture()
    await manager.install('cinerama')
    const original = await readFile(join(directory, 'cinerama.zip'))
    expect((await manager.list())[0].valid).toBe(true)
    corrupt()
    await expect(manager.install('cinerama')).rejects.toThrow('下载校验失败')
    expect(await readFile(join(directory, 'cinerama.zip'))).toEqual(original)
    expect(await readdir(directory)).toEqual(['cinerama.zip'])
  })
  it('冷启动离线重验包，篡改后的原包不可执行并可卸载', async () => {
    const { manager, directory } = await fixture()
    await manager.install('cinerama')
    const offline = new LyricModManager(directory, vi.fn(async () => { throw new Error('offline') }))
    expect((await offline.load('cinerama')).info.id).toBe('cinerama')
    await writeFile(join(directory, 'cinerama.zip'), 'tampered')
    const restart = new LyricModManager(directory)
    expect((await restart.list())[0]).toMatchObject({ id: 'cinerama', valid: false })
    await expect(restart.load('cinerama')).rejects.toThrow('签名校验失败')
    await restart.remove('cinerama')
    expect(await restart.list()).toEqual([])
  })
  it('并发安装与卸载顺序执行，不留下缓存或临时包', async () => {
    const { manager, directory } = await fixture()
    const install = manager.install('cinerama')
    const remove = manager.remove('cinerama')
    await Promise.all([install, remove])
    expect(await readdir(directory)).toEqual([])
    await expect(manager.load('cinerama')).rejects.toThrow()
  })
  it('慢速安装进行中，已安装模组仍可立即加载', async () => {
    const { manager, directory, request } = await fixture()
    await manager.install('cinerama')
    const restart = new LyricModManager(directory, request)
    const original = vi.mocked(request).getMockImplementation()!
    let release: () => void = () => {}
    let downloading: () => void = () => {}
    const started = new Promise<void>(resolve => { downloading = resolve })
    vi.mocked(request).mockImplementation(async (url, options) => {
      if (String(url).endsWith('catalog.json')) return original(url, options)
      downloading()
      await new Promise<void>(resolve => { release = resolve })
      return original(url, options)
    })
    const update = restart.install('cinerama')
    await started
    await expect(restart.load('cinerama')).resolves.toMatchObject({ info: { id: 'cinerama' } })
    release()
    await expect(update).resolves.toBeUndefined()
  })
  it.each(['https://example.com/downloads/a.zip', '//example.com/downloads/a.zip', '/downloads/../a.zip', '/downloads/a.zip?token=secret'])('拒绝市场外的下载地址 %s', value => {
    expect(() => marketUrl(value, 'downloads')).toThrow()
  })
})
