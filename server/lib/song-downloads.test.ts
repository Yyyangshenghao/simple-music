import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { audioCacheEntryId, clearAudioCacheScope, getAudioCacheConfig, openAudioCacheWriter, updateAudioCacheConfig } from './audio-cache'
import { exportDownloadedSong, getSongDownloadConfig, setSongDownloadDir, songExtension } from './song-downloads'

let userDataDir: string
const bytes = Buffer.from('fLaCtest-song')
const origin = { source: 'qq' as const, id: 'song', name: '歌曲', artist: '歌手' }
const entryId = audioCacheEntryId('qq:song:lossless')

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'sm-song-download-test-'))
  const writer = await openAudioCacheWriter(userDataDir, 'qq:song:lossless', {
    origin, resolved: origin, quality: 'lossless', expectedBytes: bytes.length, pinned: true,
  })
  await writer!.write(bytes)
  expect(await writer!.commit()).toBe(true)
})
afterEach(async () => { await rm(userDataDir, { recursive: true, force: true }) })

describe('歌曲下载目录与文件', () => {
  it('首次下载沿用用户原有缓存目录，设置下载目录不改写旧缓存配置', async () => {
    const cacheDir = join(userDataDir, 'user-existing-cache')
    expect((await updateAudioCacheConfig(userDataDir, { dir: cacheDir, confirmPinned: true })).ok).toBe(true)
    const writer = await openAudioCacheWriter(userDataDir, 'qq:song:lossless', {
      origin, resolved: origin, quality: 'lossless', expectedBytes: bytes.length, pinned: true,
    })
    await writer!.write(bytes)
    expect(await writer!.commit()).toBe(true)
    expect(await getSongDownloadConfig(userDataDir)).toEqual({ dir: cacheDir })
    const downloaded = await exportDownloadedSong(userDataDir, entryId, origin, cacheDir)
    await setSongDownloadDir(userDataDir, join(userDataDir, 'new-downloads'))
    expect((await getAudioCacheConfig(userDataDir)).dir).toBe(cacheDir)
    expect(await readFile(join(cacheDir, `${entryId}.bin`))).toEqual(bytes)
    expect(await readFile(downloaded.filePath)).toEqual(bytes)
    expect(await clearAudioCacheScope(userDataDir, 'all')).toEqual({ ok: true })
    expect(await readFile(downloaded.filePath)).toEqual(bytes)
  })
  it('导出真实扩展名和可读名称，并永不覆盖已有同名歌曲', async () => {
    const dir = join(userDataDir, 'songs')
    await setSongDownloadDir(userDataDir, dir)
    const existing = join(dir, '歌手 - 歌曲.flac')
    await writeFile(existing, '用户文件')
    const result = await exportDownloadedSong(userDataDir, entryId, origin, dir)
    expect(result.filePath).toBe(join(dir, '歌手 - 歌曲 (1).flac'))
    expect(await readFile(result.filePath)).toEqual(bytes)
    expect(await readFile(existing, 'utf8')).toBe('用户文件')
    expect((await readdir(dir)).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('并发下载同名歌曲各有独立完整文件', async () => {
    const dir = join(userDataDir, 'songs')
    const files = await Promise.all(Array.from({ length: 3 }, () => exportDownloadedSong(userDataDir, entryId, origin, dir)))
    expect(new Set(files.map((file) => file.filePath)).size).toBe(3)
    for (const file of files) expect(await readFile(file.filePath)).toEqual(bytes)
  })

  it('换目录及清空播放器缓存不会删除已下载歌曲', async () => {
    const oldDir = join(userDataDir, 'old-songs')
    const newDir = join(userDataDir, 'new-songs')
    await setSongDownloadDir(userDataDir, oldDir)
    const exported = await exportDownloadedSong(userDataDir, entryId, origin, oldDir)
    await setSongDownloadDir(userDataDir, newDir)
    expect(await getSongDownloadConfig(userDataDir)).toEqual({ dir: newDir })
    expect(await clearAudioCacheScope(userDataDir, 'all')).toEqual({ ok: true })
    expect(await readFile(exported.filePath)).toEqual(bytes)
  })

  it('清理路径字符并限制名称长度，文件始终在选择的目录内', async () => {
    const dir = join(userDataDir, 'songs')
    const result = await exportDownloadedSong(userDataDir, entryId, { ...origin, artist: '../../', name: `${'歌'.repeat(200)}:/*?` }, dir)
    expect(dirname(result.filePath)).toBe(dir)
    expect(Buffer.byteLength(result.filePath.split('/').at(-1)!)).toBeLessThan(255)
    expect(await readFile(result.filePath)).toEqual(bytes)
  })

  it('错误的歌曲归属和相对目录不能导出任意缓存文件', async () => {
    await expect(exportDownloadedSong(userDataDir, entryId, { ...origin, id: 'other' }, join(userDataDir, 'songs'))).rejects.toThrow('本地音频不存在')
    await expect(exportDownloadedSong(userDataDir, entryId, origin, '../songs')).rejects.toThrow('有效的下载文件夹')
    await expect(setSongDownloadDir(userDataDir, '../songs')).rejects.toThrow('有效的下载文件夹')
  })

  it('已取消任务不留下完整或临时歌曲文件', async () => {
    const dir = join(userDataDir, 'songs')
    const controller = new AbortController()
    controller.abort()
    await expect(exportDownloadedSong(userDataDir, entryId, origin, dir, controller.signal)).rejects.toThrow()
    expect(await readdir(dir).catch(() => [])).toEqual([])
    expect(await clearAudioCacheScope(userDataDir, 'all')).toEqual({ ok: true })
  })

  it('文件头优先于不准确的 MIME，扩展名符合常见音频格式', () => {
    expect(songExtension(Buffer.from('fLaCxxxx'), 'audio/mpeg')).toBe('.flac')
    expect(songExtension(Buffer.from('RIFFxxxxWAVE'), 'audio/mpeg')).toBe('.wav')
    expect(songExtension(Buffer.from('xxxxftypM4A '), 'audio/mp4')).toBe('.m4a')
    expect(songExtension(Buffer.from([0xff, 0xf1]), 'audio/aac')).toBe('.aac')
    expect(songExtension(Buffer.from([0xff, 0xfb]), 'audio/mpeg')).toBe('.mp3')
  })
})
