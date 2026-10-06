import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
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
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(userDataDir, { recursive: true, force: true })
})

describe('歌曲下载目录与文件', () => {
  it('已有下载配置即使与缓存同目录也保留，设置下载目录不改写旧缓存配置', async () => {
    const cacheDir = join(userDataDir, 'user-existing-cache')
    expect((await updateAudioCacheConfig(userDataDir, { dir: cacheDir, confirmPinned: true })).ok).toBe(true)
    const writer = await openAudioCacheWriter(userDataDir, 'qq:song:lossless', {
      origin, resolved: origin, quality: 'lossless', expectedBytes: bytes.length, pinned: true,
    })
    await writer!.write(bytes)
    expect(await writer!.commit()).toBe(true)
    const oldConfig = JSON.stringify({ dir: cacheDir })
    await writeFile(join(userDataDir, 'song-downloads.json'), oldConfig)
    expect(await getSongDownloadConfig(userDataDir, join(userDataDir, 'new-default'))).toEqual({ dir: cacheDir })
    expect(await readFile(join(userDataDir, 'song-downloads.json'), 'utf8')).toBe(oldConfig)
    const downloaded = await exportDownloadedSong(userDataDir, entryId, origin, cacheDir)
    await setSongDownloadDir(userDataDir, join(userDataDir, 'new-downloads'))
    expect((await getAudioCacheConfig(userDataDir)).dir).toBe(cacheDir)
    expect(await readFile(join(cacheDir, `${entryId}.bin`))).toEqual(bytes)
    expect(await readFile(downloaded.filePath)).toEqual(bytes)
    expect(await clearAudioCacheScope(userDataDir, 'all')).toEqual({ ok: true })
    expect(await readFile(downloaded.filePath)).toEqual(bytes)
  })

  it('低版本升级仅切换新下载位置，原缓存、离线索引与已导出歌曲保持可读', async () => {
    const cacheDir = (await getAudioCacheConfig(userDataDir)).dir
    const oldSong = await exportDownloadedSong(userDataDir, entryId, origin, cacheDir)
    const indexPath = join(cacheDir, '.audio-cache-index-v1.json')
    const oldIndex = await readFile(indexPath, 'utf8')
    const dir = join(userDataDir, 'music', 'Simple Music')
    expect(await getSongDownloadConfig(userDataDir, dir)).toEqual({ dir })
    expect(JSON.parse(await readFile(join(userDataDir, 'song-downloads.json'), 'utf8'))).toEqual({ dir, mode: 'default' })
    expect(await getSongDownloadConfig(userDataDir, join(userDataDir, 'other-default'))).toEqual({ dir })
    expect((await getAudioCacheConfig(userDataDir)).dir).toBe(cacheDir)
    expect(await readFile(indexPath, 'utf8')).toBe(oldIndex)
    expect(await readFile(join(cacheDir, `${entryId}.bin`))).toEqual(bytes)
    const newSong = await exportDownloadedSong(userDataDir, entryId, origin, dir)
    expect(dirname(newSong.filePath)).toBe(dir)
    expect(await clearAudioCacheScope(userDataDir, 'all')).toEqual({ ok: true })
    expect(await readFile(oldSong.filePath)).toEqual(bytes)
    expect(await readFile(newSong.filePath)).toEqual(bytes)
  })

  it.each(['{broken', 'null', JSON.stringify({ dir: 'relative' })])('损坏配置 %s 原样保留并回退，不自动切换目录', async (raw) => {
    const path = join(userDataDir, 'song-downloads.json')
    await writeFile(path, raw)
    expect(await getSongDownloadConfig(userDataDir, join(userDataDir, 'new-default'))).toEqual({
      dir: (await getAudioCacheConfig(userDataDir)).dir,
    })
    expect(await readFile(path, 'utf8')).toBe(raw)
    expect(await readdir(userDataDir)).not.toContain('new-default')
  })

  it('新默认目录不可写时回退原缓存位置，保留目录中的用户文件', async () => {
    const dir = join(userDataDir, 'blocked')
    await fs.mkdir(dir)
    const existing = join(dir, '用户文件.mp3')
    await writeFile(existing, '用户内容')
    const write = fs.writeFile.bind(fs)
    vi.spyOn(fs, 'writeFile').mockImplementation((...args) => {
      if (String(args[0]).startsWith(join(dir, '.simplemusic-write-'))) {
        return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      }
      return write(...args)
    })
    const fallback = (await getAudioCacheConfig(userDataDir)).dir
    expect(await getSongDownloadConfig(userDataDir, dir)).toEqual({ dir: fallback })
    expect(await readFile(existing, 'utf8')).toBe('用户内容')
    expect(await readdir(dir)).toEqual(['用户文件.mp3'])
    expect(await readFile(join(fallback, `${entryId}.bin`))).toEqual(bytes)
  })

  it('旧下载配置读取权限失败时原样保留，不启用新默认目录', async () => {
    const path = join(userDataDir, 'song-downloads.json')
    const raw = JSON.stringify({ dir: join(userDataDir, 'old-custom') })
    await writeFile(path, raw)
    const read = fs.readFile.bind(fs)
    vi.spyOn(fs, 'readFile').mockImplementation((...args) => {
      if (args[0] === path) return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      return read(...args)
    })
    expect(await getSongDownloadConfig(userDataDir, join(userDataDir, 'new-default'))).toEqual({
      dir: (await getAudioCacheConfig(userDataDir)).dir,
    })
    expect(await readFile(path, 'utf8')).toBe(raw)
    expect(await readdir(userDataDir)).not.toContain('new-default')
  })

  it('新默认目录与现有用户文件重名时回退，不覆盖该文件', async () => {
    const dir = join(userDataDir, 'existing-file')
    await writeFile(dir, '用户内容')
    expect(await getSongDownloadConfig(userDataDir, dir)).toEqual({ dir: (await getAudioCacheConfig(userDataDir)).dir })
    expect(await readFile(dir, 'utf8')).toBe('用户内容')
  })

  it('初始化期间外部出现下载配置时读取该配置，不覆盖外部选择', async () => {
    const path = join(userDataDir, 'song-downloads.json')
    const chosen = join(userDataDir, 'external-choice')
    const raw = JSON.stringify({ dir: chosen })
    const write = fs.writeFile.bind(fs)
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      if (args[0] === path) await write(path, raw, { flag: 'wx' })
      return write(...args)
    })
    expect(await getSongDownloadConfig(userDataDir, join(userDataDir, 'new-default'))).toEqual({ dir: chosen })
    expect(await readFile(path, 'utf8')).toBe(raw)
  })

  it('未提供系统目录时沿用缓存位置；用户主动选目录写入自定义标记', async () => {
    expect(await getSongDownloadConfig(userDataDir)).toEqual({ dir: (await getAudioCacheConfig(userDataDir)).dir })
    const dir = join(userDataDir, 'chosen')
    await setSongDownloadDir(userDataDir, dir)
    expect(JSON.parse(await readFile(join(userDataDir, 'song-downloads.json'), 'utf8'))).toEqual({ dir, mode: 'custom' })
    const blocked = join(userDataDir, 'blocked-file')
    await writeFile(blocked, '用户文件')
    await expect(setSongDownloadDir(userDataDir, blocked)).rejects.toThrow()
    expect(await getSongDownloadConfig(userDataDir, join(userDataDir, 'new-default'))).toEqual({ dir })
    expect(await readFile(blocked, 'utf8')).toBe('用户文件')
  })

  it('初始化与用户选择目录并发时，后续读取和落盘配置保留用户选择', async () => {
    const dir = join(userDataDir, 'new-default')
    const chosen = join(userDataDir, 'chosen')
    let entered!: () => void
    let resume!: () => void
    const preparing = new Promise<void>((resolve) => { entered = resolve })
    const blocked = new Promise<void>((resolve) => { resume = resolve })
    const mkdir = fs.mkdir.bind(fs)
    vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
      if (args[0] === dir) { entered(); await blocked }
      return mkdir(...args)
    })
    const initializing = getSongDownloadConfig(userDataDir, dir)
    await preparing
    const selecting = setSongDownloadDir(userDataDir, chosen)
    const reading = getSongDownloadConfig(userDataDir, dir)
    resume()
    expect(await initializing).toEqual({ dir })
    expect(await selecting).toEqual({ dir: chosen })
    expect(await reading).toEqual({ dir: chosen })
    expect(JSON.parse(await readFile(join(userDataDir, 'song-downloads.json'), 'utf8'))).toEqual({ dir: chosen, mode: 'custom' })
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
