import { describe, it, expect } from 'vitest'
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
})
