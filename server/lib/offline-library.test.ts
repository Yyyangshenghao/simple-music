import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCachedAudio, listSavedAudioCache, openAudioCacheWriter, pinAudioCacheEntry, type AudioCacheOriginInput } from './audio-cache'

async function save(dir: string, origin: AudioCacheOriginInput, pinned = true, key = `${origin.source}:${origin.id}:standard`) {
  const writer = await openAudioCacheWriter(dir, key, {
    origin, resolved: { source: key.split(':')[0] as 'netease' | 'qq', id: key.split(':')[1], name: '真实音源' },
    quality: 'standard', expectedBytes: 4, pinned,
  })
  await writer!.write(new Uint8Array([1, 2, 3, 4]))
  expect(await writer!.commit()).toBe(true)
  return (await findCachedAudio(dir, key))!
}

describe('离线音乐库', () => {
  it('播放命中缓存的身份上下文不会清空保存歌曲的资料', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-offline-metadata-'))
    try {
      const origin = { source: 'netease' as const, id: '1', name: '原始歌名', artist: '艺人', album: '专辑', cover: 'https://example.com/cover.jpg', duration: 123000 }
      await save(dir, origin)
      const before = (await listSavedAudioCache(dir))[0]
      const hit = await findCachedAudio(dir, 'netease:1:standard', {
        origin: { source: 'netease', id: '1' },
        resolved: { source: 'netease', id: '1' },
        quality: 'standard',
      }, true)
      hit?.release?.()
      expect((await listSavedAudioCache(dir))[0]).toMatchObject({ origin, savedAt: before.savedAt })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('只列主动保存内容，保留原始身份与资料且不暴露磁盘路径', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-offline-library-'))
    try {
      const origin = { source: 'netease' as const, id: '1', name: '原始歌名', artist: '艺人', album: '专辑', duration: 123000 }
      await save(dir, origin)
      await save(dir, { source: 'qq', id: '1', name: '另一平台同 ID' })
      await save(dir, { source: 'netease', id: 'temporary' }, false)
      const items = await listSavedAudioCache(dir)
      expect(items).toHaveLength(2)
      expect(items.find((item) => item.origin.source === 'netease')).toMatchObject({ origin, size: 4, quality: 'standard', savedAt: expect.any(Number) })
      expect(JSON.stringify(items)).not.toContain(dir)
      expect(items[0].savedAt).toBeGreaterThanOrEqual(items[1].savedAt)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('共用文件取消一个别名的保存，只从列表移除该曲目', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-offline-shared-'))
    try {
      const first = { source: 'netease' as const, id: '1' }
      const second = { source: 'qq' as const, id: '2' }
      const key = 'qq:actual-mid:standard'
      const file = await save(dir, first, true, key)
      await save(dir, second, true, key)
      const items = await listSavedAudioCache(dir)
      expect(items).toHaveLength(2)
      expect(await pinAudioCacheEntry(dir, items[0].entryId, first, false)).toEqual({ ok: true })
      expect((await listSavedAudioCache(dir)).map((item) => item.origin)).toEqual([second])
      expect(await findCachedAudio(dir, key)).toMatchObject({ path: file.path, size: 4 })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it.each(['missing', 'damaged'])('不列出 %s 文件，同时修正索引', async (state) => {
    const dir = await mkdtemp(join(tmpdir(), 'sm-offline-invalid-'))
    try {
      const file = await save(dir, { source: 'netease', id: '1' })
      if (state === 'missing') await rm(file.path)
      else await writeFile(file.path, new Uint8Array([1]))
      expect(await listSavedAudioCache(dir)).toEqual([])
      expect(await listSavedAudioCache(dir)).toEqual([])
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
