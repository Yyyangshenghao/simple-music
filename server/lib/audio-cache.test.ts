import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, writeFile, utimes, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isFullStreamRequest,
  coversWholeFile,
  parseByteRange,
  findCachedAudio,
  openAudioCacheWriter,
  enforceCacheLimit,
  audioCacheStats,
  clearAudioCache,
  audioCacheDir,
  getAudioCacheConfig,
  updateAudioCacheConfig,
  AUDIO_CACHE_LIMIT_BYTES,
  AUDIO_CACHE_MIN_LIMIT,
  AUDIO_CACHE_MAX_LIMIT,
  getAudioCacheStatuses,
  pinAudioCacheEntry,
  deleteAudioCacheEntry,
  clearAudioCacheScope,
  openAudioCacheEntry,
} from './audio-cache'

describe('isFullStreamRequest', () => {
  it('无 Range 或 bytes=0- 视为整流', () => {
    expect(isFullStreamRequest('')).toBe(true)
    expect(isFullStreamRequest('bytes=0-')).toBe(true)
    expect(isFullStreamRequest('Bytes=0-')).toBe(true)
  })
  it('中段/闭区间 Range 不是整流', () => {
    expect(isFullStreamRequest('bytes=1024-')).toBe(false)
    expect(isFullStreamRequest('bytes=0-1023')).toBe(false)
  })
})

describe('coversWholeFile', () => {
  it('200 覆盖完整文件', () => {
    expect(coversWholeFile(200, null)).toBe(true)
  })
  it('206 且 Content-Range 从 0 到末尾时覆盖完整文件', () => {
    expect(coversWholeFile(206, 'bytes 0-999/1000')).toBe(true)
    expect(coversWholeFile(206, 'bytes 0-998/1000')).toBe(false)
    expect(coversWholeFile(206, 'bytes 100-999/1000')).toBe(false)
    expect(coversWholeFile(206, null)).toBe(false)
  })
  it('其他状态码不缓存', () => {
    expect(coversWholeFile(403, null)).toBe(false)
  })
})

describe('parseByteRange', () => {
  it('开区间与闭区间', () => {
    expect(parseByteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseByteRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 })
  })
  it('越界或无效形态返回 null', () => {
    expect(parseByteRange('bytes=100-', 100)).toBeNull()
    expect(parseByteRange('bytes=-500', 100)).toBeNull()
    expect(parseByteRange('items=0-1', 100)).toBeNull()
  })
})

describe('磁盘读写(临时目录)', () => {
  async function makeUserDataDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'sm-audio-cache-test-'))
  }

  it('writer 完整提交后可命中,内容一致', async () => {
    const userData = await makeUserDataDir()
    const w = await openAudioCacheWriter(userData, 'netease:1:standard')
    expect(w).not.toBeNull()
    w!.write(new Uint8Array([1, 2, 3]))
    w!.write(new Uint8Array([4, 5]))
    await w!.commit()

    const hit = await findCachedAudio(userData, 'netease:1:standard')
    expect(hit).not.toBeNull()
    expect(hit!.size).toBe(5)
    expect([...(await readFile(hit!.path))]).toEqual([1, 2, 3, 4, 5])
    // 不同 key 不命中
    expect(await findCachedAudio(userData, 'netease:2:standard')).toBeNull()
  })

  it('writer abort 不留正式缓存', async () => {
    const userData = await makeUserDataDir()
    const w = await openAudioCacheWriter(userData, 'qq:x:higher')
    w!.write(new Uint8Array(10))
    w!.abort()
    expect(await findCachedAudio(userData, 'qq:x:higher')).toBeNull()
  })

  it('enforceCacheLimit 从最旧开始淘汰到限额内', async () => {
    const userData = await makeUserDataDir()
    const dir = audioCacheDir(userData)
    for (let i = 0; i < 4; i++) {
      const w = await openAudioCacheWriter(userData, `k${i}`)
      w!.write(new Uint8Array(100))
      await w!.commit()
    }
    // 人为拉开 mtime:k0 最旧、k3 最新
    for (let i = 0; i < 4; i++) {
      const hit = await findCachedAudio(userData, `k${i}`)
      const t = new Date(Date.now() - (4 - i) * 60_000)
      await utimes(hit!.path, t, t)
    }
    // 总量 400,限额 250 → 淘汰最旧的两个(k0/k1)
    await enforceCacheLimit(dir, 250)
    const stats = await audioCacheStats(userData)
    expect(stats.bytes).toBeLessThanOrEqual(250)
    expect(stats.files).toBe(2)
    expect(await findCachedAudio(userData, 'k0')).toBeNull()
    expect(await findCachedAudio(userData, 'k3')).not.toBeNull()
  })

  it('默认配置:userDataDir/audio-cache + 2GB 上限', async () => {
    const userData = await makeUserDataDir()
    const config = await getAudioCacheConfig(userData)
    expect(config.dir).toBe(audioCacheDir(userData))
    expect(config.limitBytes).toBe(AUDIO_CACHE_LIMIT_BYTES)
  })

  it('上限钳制到 [256MB, 100GB]', async () => {
    const userData = await makeUserDataDir()
    const low = await updateAudioCacheConfig(userData, { limitBytes: 1 })
    expect(low.ok && low.config.limitBytes).toBe(AUDIO_CACHE_MIN_LIMIT)
    const high = await updateAudioCacheConfig(userData, { limitBytes: Number.MAX_SAFE_INTEGER })
    expect(high.ok && high.config.limitBytes).toBe(AUDIO_CACHE_MAX_LIMIT)
  })

  it('相对路径目录被拒绝', async () => {
    const userData = await makeUserDataDir()
    const r = await updateAudioCacheConfig(userData, { dir: 'relative/path' })
    expect(r).toEqual({ ok: false, error: 'DIR_NOT_ABSOLUTE' })
  })

  it('切换目录:旧目录缓存清空、新写入落新目录、可恢复默认', async () => {
    const userData = await makeUserDataDir()
    const w = await openAudioCacheWriter(userData, 'k')
    w!.write(new Uint8Array(8))
    await w!.commit()
    expect(await findCachedAudio(userData, 'k')).not.toBeNull()

    const newDir = join(userData, 'elsewhere')
    const r = await updateAudioCacheConfig(userData, { dir: newDir })
    expect(r.ok).toBe(true)
    // 旧目录缓存已被清空,新目录没有该 key → 未命中
    expect(await findCachedAudio(userData, 'k')).toBeNull()

    const w2 = await openAudioCacheWriter(userData, 'k2')
    w2!.write(new Uint8Array(4))
    await w2!.commit()
    const hit = await findCachedAudio(userData, 'k2')
    expect(hit!.path.startsWith(newDir)).toBe(true)
    expect((await audioCacheStats(userData)).dir).toBe(newDir)

    const reset = await updateAudioCacheConfig(userData, { dir: '' })
    expect(reset.ok && reset.config.dir).toBe(audioCacheDir(userData))
  })

  it('clearAudioCache 清空 .bin 与 .part', async () => {
    const userData = await makeUserDataDir()
    const w = await openAudioCacheWriter(userData, 'a')
    w!.write(new Uint8Array(8))
    await w!.commit()
    await writeFile(join(audioCacheDir(userData), 'leftover.part'), new Uint8Array(4))
    await clearAudioCache(userData)
    const stats = await audioCacheStats(userData)
    expect(stats.bytes).toBe(0)
    expect(stats.files).toBe(0)
    expect((await readdir(audioCacheDir(userData))).filter((n) => n.endsWith('.part'))).toEqual([])
  })

  it('主动保存写入固定状态，取消固定后降级为自动缓存', async () => {
    const userData = await makeUserDataDir()
    const context = {
      origin: { source: 'netease' as const, id: '1', name: '歌名' },
      resolved: { source: 'qq' as const, id: 'mid-1' },
      quality: 'lossless',
      contentType: 'audio/flac',
      pinned: true,
      expectedBytes: 4,
    }
    const writer = await openAudioCacheWriter(userData, 'qq:mid-1:lossless', context)
    await writer!.write(new Uint8Array([1, 2, 3, 4]))
    expect(await writer!.commit()).toBe(true)
    const [saved] = await getAudioCacheStatuses(userData, [{ source: 'netease', id: '1' }])
    expect(saved).toMatchObject({ state: 'pinned', quality: 'lossless', size: 4, savedAliasCount: 1 })
    expect(saved.resolved).toMatchObject({ source: 'qq', id: 'mid-1' })

    expect(await pinAudioCacheEntry(userData, saved.entryId!, context.origin, false)).toEqual({ ok: true })
    const [cached] = await getAudioCacheStatuses(userData, [{ source: 'netease', id: '1' }])
    expect(cached.state).toBe('cached')

    expect(await pinAudioCacheEntry(userData, saved.entryId!, context.origin, true)).toEqual({ ok: true })
    const [repinned] = await getAudioCacheStatuses(userData, [{ source: 'netease', id: '1' }])
    expect(repinned).toMatchObject({ state: 'pinned', savedAliasCount: 1 })
    await clearAudioCacheScope(userData, 'temporary')
    expect(await readFile(join(audioCacheDir(userData), `${saved.entryId}.bin`))).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  it('主动保存会替换同 key 下体积不符的旧文件', async () => {
    const userData = await makeUserDataDir()
    const old = await openAudioCacheWriter(userData, 'netease:1:standard')
    await old!.write(new Uint8Array([1, 2]))
    await old!.commit()
    const replacement = await openAudioCacheWriter(userData, 'netease:1:standard', {
      origin: { source: 'netease', id: '1' },
      resolved: { source: 'netease', id: '1' },
      quality: 'standard',
      contentType: 'audio/mpeg',
      expectedBytes: 3,
      pinned: true,
    })
    await replacement!.write(new Uint8Array([3, 4, 5]))
    expect(await replacement!.commit()).toBe(true)
    const hit = await findCachedAudio(userData, 'netease:1:standard')
    expect([...(await readFile(hit!.path))]).toEqual([3, 4, 5])
  })

  it('目录迁移预检后拒绝新增固定承诺', async () => {
    const userData = await makeUserDataDir()
    const context = {
      origin: { source: 'netease' as const, id: '1' },
      resolved: { source: 'netease' as const, id: '1' }, quality: 'standard',
      contentType: 'audio/mpeg', expectedBytes: 4,
    }
    const writer = await openAudioCacheWriter(userData, 'netease:1:standard', context)
    await writer!.write(new Uint8Array([1, 2, 3, 4]))
    await writer!.commit()
    const [cached] = await getAudioCacheStatuses(userData, [context.origin])
    const nextDir = await mkdtemp(join(tmpdir(), 'sm-cache-migration-test-'))
    let entered!: () => void
    let resume!: () => void
    const reached = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { resume = resolve })
    const original = fs.rename
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (newPath === join(userData, 'audio-cache-config.json')) {
        entered()
        await gate
      }
      return original(oldPath, newPath)
    })
    const moving = updateAudioCacheConfig(userData, { dir: nextDir })
    try {
      await reached
      expect(await pinAudioCacheEntry(userData, cached.entryId!, context.origin, true)).toEqual({ ok: false, error: 'CACHE_BUSY' })
    } finally {
      resume()
      await moving
      rename.mockRestore()
    }
  })

  it.each(['path', 'alias'])('损坏索引 %s 不能访问或删除缓存目录外文件', async (kind) => {
    const userData = await makeUserDataDir()
    const context = {
      origin: { source: 'netease' as const, id: '1' },
      resolved: { source: 'netease' as const, id: '1' }, quality: 'standard',
      contentType: 'audio/mpeg', expectedBytes: 4, pinned: true,
    }
    const writer = await openAudioCacheWriter(userData, 'netease:1:standard', context)
    await writer!.write(new Uint8Array([1, 2, 3, 4]))
    await writer!.commit()
    const [saved] = await getAudioCacheStatuses(userData, [context.origin])
    const outside = join(userData, 'outside.bin')
    await writeFile(outside, Buffer.from([1, 2, 3, 4]))
    const indexPath = join(audioCacheDir(userData), '.audio-cache-index-v1.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8'))
    if (kind === 'path') index.entries[saved.entryId!].fileName = '../outside.bin'
    else index.entries[saved.entryId!].origins = [null]
    const raw = JSON.stringify(index)
    await writeFile(indexPath, raw)
    await writeFile(join(audioCacheDir(userData), '.audio-cache-index-v1.bak.json'), raw)
    const hit = await openAudioCacheEntry(userData, saved.entryId!, context.origin)
    hit?.release()
    expect(hit).toBeNull()
    expect(await deleteAudioCacheEntry(userData, saved.entryId!, context.origin)).toEqual({ ok: false, error: 'NOT_FOUND' })
    expect(await readFile(outside)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(await audioCacheStats(userData)).toMatchObject({ unmanagedFiles: 1, pinnedFiles: 0 })
  })

  it('共享物理文件有其他已保存别名时需要显式确认才能删除', async () => {
    const userData = await makeUserDataDir()
    for (const id of ['1', '2']) {
      const writer = await openAudioCacheWriter(userData, 'qq:shared:standard', {
        origin: { source: 'netease', id },
        resolved: { source: 'qq', id: 'shared' },
        quality: 'standard',
        contentType: 'audio/mpeg',
        pinned: true,
        expectedBytes: 3,
      })
      await writer!.write(new Uint8Array([1, 2, 3]))
      expect(await writer!.commit()).toBe(true)
    }
    const [status] = await getAudioCacheStatuses(userData, [{ source: 'netease', id: '1' }])
    expect(status.savedAliasCount).toBe(2)
    expect(await deleteAudioCacheEntry(userData, status.entryId!, { source: 'netease', id: '1' })).toEqual({
      ok: false,
      error: 'CACHE_SHARED',
      savedAliasCount: 2,
    })
    expect((await deleteAudioCacheEntry(userData, status.entryId!, { source: 'netease', id: '1' }, true)).ok).toBe(true)
  })

  it('自动缓存别名共享一个已固定别名时也必须确认删除', async () => {
    const userData = await makeUserDataDir()
    const resolved = { source: 'netease' as const, id: 'audio' }
    const cachedOrigin = { source: 'qq' as const, id: 'cached-origin' }
    const pinnedOrigin = { source: 'netease' as const, id: 'pinned-origin' }
    for (const [origin, pinned] of [[pinnedOrigin, true], [cachedOrigin, false]] as const) {
      const writer = await openAudioCacheWriter(userData, 'netease:audio:standard', {
        origin, resolved, quality: 'standard', contentType: 'audio/mpeg', expectedBytes: 4, pinned,
      })
      await writer!.write(new Uint8Array([1, 2, 3, 4]))
      expect(await writer!.commit()).toBe(true)
    }
    const [cached] = await getAudioCacheStatuses(userData, [cachedOrigin])
    expect(cached).toMatchObject({ state: 'cached', savedAliasCount: 1 })
    expect(await deleteAudioCacheEntry(userData, cached.entryId!, cachedOrigin)).toMatchObject({ ok: false, error: 'CACHE_SHARED' })
    expect(await deleteAudioCacheEntry(userData, cached.entryId!, cachedOrigin, true)).toEqual({ ok: true })
    expect((await getAudioCacheStatuses(userData, [pinnedOrigin]))[0].state).toBe('missing')
  })

  it('文件正在播放时拒绝删除，读租约释放后可删除', async () => {
    const userData = await makeUserDataDir()
    const context = {
      origin: { source: 'netease' as const, id: 'playing' },
      resolved: { source: 'netease' as const, id: 'playing' },
      quality: 'standard',
      pinned: true,
    }
    const writer = await openAudioCacheWriter(userData, 'netease:playing:standard', context)
    await writer!.write(new Uint8Array(5))
    await writer!.commit()
    const hit = await findCachedAudio(userData, 'netease:playing:standard', context, true)
    expect(hit?.release).toBeTypeOf('function')
    expect(await deleteAudioCacheEntry(userData, hit!.entryId, context.origin)).toEqual({ ok: false, error: 'CACHE_BUSY' })
    hit!.release?.()
    expect(await deleteAudioCacheEntry(userData, hit!.entryId, context.origin)).toEqual({ ok: true })
  })

  it('按分类清理时保留已保存文件', async () => {
    const userData = await makeUserDataDir()
    const temporary = await openAudioCacheWriter(userData, 'netease:temp:standard', {
      origin: { source: 'netease', id: 'temp' },
      resolved: { source: 'netease', id: 'temp' },
      quality: 'standard',
    })
    await temporary!.write(new Uint8Array(3))
    await temporary!.commit()
    const pinned = await openAudioCacheWriter(userData, 'netease:saved:standard', {
      origin: { source: 'netease', id: 'saved' },
      resolved: { source: 'netease', id: 'saved' },
      quality: 'standard',
      pinned: true,
    })
    await pinned!.write(new Uint8Array(5))
    await pinned!.commit()

    expect(await clearAudioCacheScope(userData, 'temporary')).toEqual({ ok: true })
    const stats = await audioCacheStats(userData)
    expect(stats).toMatchObject({ temporaryFiles: 0, pinnedFiles: 1, bytes: 5 })
  })

  it('主备索引都损坏时隔离现有文件，不再按已知 key 直接命中', async () => {
    const userData = await makeUserDataDir()
    const writer = await openAudioCacheWriter(userData, 'netease:isolated:standard')
    await writer!.write(new Uint8Array(6))
    await writer!.commit()
    const dir = audioCacheDir(userData)
    await writeFile(join(dir, '.audio-cache-index-v1.json'), '{broken')
    await writeFile(join(dir, '.audio-cache-index-v1.bak.json'), '{broken')

    expect(await findCachedAudio(userData, 'netease:isolated:standard')).toBeNull()
    expect(await audioCacheStats(userData)).toMatchObject({ unmanagedFiles: 1, unmanagedBytes: 6 })
  })
})
