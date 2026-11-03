import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  audioCacheEntryId, audioCacheStats, clearAudioCacheScope, getAudioCacheConfig, getAudioCacheStatuses,
  listSavedAudioCache, openAudioCacheWriter,
} from './audio-cache'
import { downloadFromCache, findDownload, listDownloads, reconcileDownloads, removeDownload } from './download-library'
import { setSongDownloadDir } from './song-downloads'

let userDataDir: string
let downloadDir: string
const flac = Buffer.from('fLaCold-offline-song')

async function pinnedEntry(id: string, bytes = flac, name = `歌曲${id}`) {
  const origin = { source: 'netease' as const, id, name, artist: '歌手' }
  const writer = await openAudioCacheWriter(userDataDir, `netease:${id}:lossless`, {
    origin, resolved: origin, quality: 'lossless', expectedBytes: bytes.length, pinned: true,
  })
  await writer!.write(bytes)
  expect(await writer!.commit()).toBe(true)
  return { origin, entryId: audioCacheEntryId(`netease:${id}:lossless`) }
}

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'sm-download-library-'))
  downloadDir = join(userDataDir, 'Music', 'Simple Music')
})
afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true })
})

describe('老用户升级：离线音乐转为已下载', () => {
  it('以前下载过（同名同大小文件已在下载目录）直接认领，不复制第二份', async () => {
    const { origin } = await pinnedEntry('a')
    await setSongDownloadDir(userDataDir, downloadDir)
    await writeFile(join(downloadDir, '歌手 - 歌曲a.flac'), flac)
    const [before] = await listSavedAudioCache(userDataDir)

    await reconcileDownloads(userDataDir)

    expect(await readdir(downloadDir)).toEqual(['歌手 - 歌曲a.flac'])
    const [item] = await listDownloads(userDataDir)
    expect(item).toMatchObject({ origin: { id: 'a' }, filePath: join(downloadDir, '歌手 - 歌曲a.flac'), savedAt: before.savedAt, quality: 'lossless' })
    // 原缓存那份不再固定，回归普通缓存，按上限自然清理
    expect(await listSavedAudioCache(userDataDir)).toEqual([])
    expect((await getAudioCacheStatuses(userDataDir, [origin]))[0].state).toBe('cached')
  })

  it('只「保存为离线音乐」从未导出的歌，导出到下载目录并保留原保存时间', async () => {
    await pinnedEntry('b')
    await setSongDownloadDir(userDataDir, downloadDir)
    const [before] = await listSavedAudioCache(userDataDir)

    await reconcileDownloads(userDataDir)

    const [item] = await listDownloads(userDataDir)
    expect(item.savedAt).toBe(before.savedAt)
    expect(await readFile(item.filePath)).toEqual(flac)
    expect(item.filePath.startsWith(downloadDir)).toBe(true)
  })

  it('同名但大小不同的文件不认领，另存带序号的新文件，不覆盖用户原文件', async () => {
    await pinnedEntry('c')
    await setSongDownloadDir(userDataDir, downloadDir)
    await writeFile(join(downloadDir, '歌手 - 歌曲c.flac'), 'user-edited')

    await reconcileDownloads(userDataDir)

    const [item] = await listDownloads(userDataDir)
    expect(item.filePath).toBe(join(downloadDir, '歌手 - 歌曲c (1).flac'))
    expect(await readFile(join(downloadDir, '歌手 - 歌曲c.flac'), 'utf8')).toBe('user-edited')
  })

  it('没有下载配置的老用户用系统音乐目录；下载目录沿用缓存目录的老配置时清缓存也不删歌', async () => {
    await pinnedEntry('d')
    const cacheDir = (await getAudioCacheConfig(userDataDir)).dir
    await writeFile(join(userDataDir, 'song-downloads.json'), JSON.stringify({ dir: cacheDir }))

    await reconcileDownloads(userDataDir, downloadDir)

    const [item] = await listDownloads(userDataDir)
    expect(item.filePath.startsWith(cacheDir)).toBe(true)
    expect(await clearAudioCacheScope(userDataDir, 'all')).toEqual({ ok: true })
    expect(await readFile(item.filePath)).toEqual(flac)
    expect(await listDownloads(userDataDir)).toHaveLength(1)
  })

  it('单首失败保持固定保留（仍可当缓存播放），下次启动重试，成功的不重复导出', async () => {
    await pinnedEntry('ok')
    await pinnedEntry('bad', Buffer.from('not-audio-bytes'))
    await setSongDownloadDir(userDataDir, downloadDir)

    await reconcileDownloads(userDataDir)
    expect((await listDownloads(userDataDir)).map(item => item.origin.id)).toEqual(['ok'])
    expect((await listSavedAudioCache(userDataDir)).map(item => item.origin.id)).toEqual(['bad'])

    await reconcileDownloads(userDataDir)
    expect(await readdir(downloadDir)).toEqual(['歌手 - 歌曲ok.flac'])
    expect((await listSavedAudioCache(userDataDir)).map(item => item.origin.id)).toEqual(['bad'])
  })

  it('首次启动时缓存目录读不到（外接盘未挂载），之后读到的旧离线音乐照样转存，不会被当成残留解除', async () => {
    const cacheDir = join(userDataDir, 'external-disk')
    await writeFile(join(userDataDir, 'audio-cache-config.json'), JSON.stringify({ dir: cacheDir, limitBytes: 2 * 1024 ** 3 }))
    await writeFile(join(userDataDir, 'audio-cache-index-v1.marker'), '1')
    await setSongDownloadDir(userDataDir, downloadDir)
    await reconcileDownloads(userDataDir)
    expect(await listDownloads(userDataDir)).toEqual([])

    await pinnedEntry('later')
    await reconcileDownloads(userDataDir)
    expect((await listDownloads(userDataDir)).map(item => item.origin.id)).toEqual(['later'])
  })

  it('中断的下载或降级期间新存的离线音乐，下次启动转存为已下载，不丢歌', async () => {
    await setSongDownloadDir(userDataDir, downloadDir)
    await reconcileDownloads(userDataDir)
    await pinnedEntry('interrupted')

    await reconcileDownloads(userDataDir)

    expect((await listDownloads(userDataDir)).map(item => item.origin.id)).toEqual(['interrupted'])
    expect(await listSavedAudioCache(userDataDir)).toEqual([])
  })

  it('迁移进行时手动下载同一首，等迁移结束后复用迁移的文件，不生成副本', async () => {
    const { origin, entryId } = await pinnedEntry('race')
    await setSongDownloadDir(userDataDir, downloadDir)
    const migrating = reconcileDownloads(userDataDir)
    const manual = downloadFromCache(userDataDir, entryId, origin, downloadDir)
    await migrating
    expect((await manual).filePath).toBe(join(downloadDir, '歌手 - 歌曲race.flac'))
    expect(await readdir(downloadDir)).toEqual(['歌手 - 歌曲race.flac'])
  })

  it('下载记录损坏时不覆盖、不迁移，旧离线音乐原样保留', async () => {
    await pinnedEntry('e')
    await writeFile(join(userDataDir, 'song-downloads-index.json'), '{broken')

    await reconcileDownloads(userDataDir, downloadDir)

    expect(await readFile(join(userDataDir, 'song-downloads-index.json'), 'utf8')).toBe('{broken')
    expect(await listSavedAudioCache(userDataDir)).toHaveLength(1)
  })
})

describe('已下载记录', () => {
  it('同一首重复下载复用原文件；文件在系统里被删掉后自动从列表消失', async () => {
    const { origin, entryId } = await pinnedEntry('f')
    await mkdir(downloadDir, { recursive: true })
    const first = await downloadFromCache(userDataDir, entryId, origin, downloadDir)
    const second = await downloadFromCache(userDataDir, entryId, origin, downloadDir)
    expect(second.filePath).toBe(first.filePath)
    expect(await readdir(downloadDir)).toHaveLength(1)

    await rm(first.filePath)
    expect(await findDownload(userDataDir, origin)).toBeNull()
    expect(await listDownloads(userDataDir)).toEqual([])
  })

  it('删除下载把文件交给废纸篓并移除记录', async () => {
    const { origin, entryId } = await pinnedEntry('g')
    const record = await downloadFromCache(userDataDir, entryId, origin, downloadDir)
    const trashed: string[] = []
    expect(await removeDownload(userDataDir, origin, async (path) => { trashed.push(path); await rm(path) })).toBe(true)
    expect(trashed).toEqual([record.filePath])
    expect(await listDownloads(userDataDir)).toEqual([])
    expect(await removeDownload(userDataDir, origin, async () => {})).toBe(false)
  })
})
