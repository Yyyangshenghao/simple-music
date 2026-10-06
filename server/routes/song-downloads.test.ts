import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startServer } from '../index'
import { audioCacheEntryId, getAudioCacheConfig, openAudioCacheWriter } from '../lib/audio-cache'

it('下载配置和导出经过本地 API 边界，导出到所选目录且不改变缓存路径', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'sm-download-route-'))
  const originalDir = (await getAudioCacheConfig(userDataDir)).dir
  const defaultSongDownloadDir = join(userDataDir, 'music', 'Simple Music')
  const server = await startServer({ userDataDir, defaultSongDownloadDir, port: 0, token: 'test-token' })
  const base = `http://127.0.0.1:${server.port}`
  const request = (path: string, body: unknown) => fetch(`${base}${path}?token=test-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  try {
    const bytes = Buffer.from('ID3test-song')
    const origin = { source: 'netease' as const, id: '123', name: '歌曲', artist: '歌手' }
    const writer = await openAudioCacheWriter(userDataDir, 'netease:123:standard', {
      origin, resolved: origin, quality: 'standard', expectedBytes: bytes.length, contentType: 'audio/mpeg', pinned: true,
    })
    await writer!.write(bytes)
    expect(await writer!.commit()).toBe(true)
    expect((await fetch(`${base}/api/downloads/config`)).status).toBe(401)
    expect(await (await fetch(`${base}/api/downloads/config?token=test-token`)).json()).toEqual({ dir: defaultSongDownloadDir })
    const dir = join(userDataDir, 'selected-songs')
    expect(await (await request('/api/downloads/config', { dir })).json()).toEqual({ dir })
    const response = await request('/api/downloads/export', { entryId: audioCacheEntryId('netease:123:standard'), origin, dir })
    expect(response.status).toBe(200)
    const result = await response.json() as { filePath: string; size: number }
    expect(result.filePath).toBe(join(dir, '歌手 - 歌曲.mp3'))
    expect(await readFile(result.filePath)).toEqual(bytes)
    expect((await getAudioCacheConfig(userDataDir)).dir).toBe(originalDir)
    expect((await request('/api/downloads/export', { entryId: audioCacheEntryId('netease:123:standard'), origin: { ...origin, id: 'other' }, dir })).status).toBe(400)
  } finally {
    server.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
