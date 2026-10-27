import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../index'
import { writeKaraokeStem } from '../lib/karaoke-store'
import type { Accompaniment } from '../../src/types/karaoke'

describe('伴奏库 API 与本地播放', () => {
  it('受 token 保护，保存后通过索引播放和取原曲歌词身份，不接受磁盘路径', async () => {
    const root = await mkdtemp(join(tmpdir(), 'karaoke-api-'))
    const directory = join(root, 'output')
    const server = await startServer({ userDataDir: root, token: 'test-token', defaultKaraokeDir: directory, karaokeMemory: () => ({ total: 32 * 1024 ** 3, free: 5 * 1024 ** 3 }) })
    const base = `http://127.0.0.1:${server.port}`
    const get = (path: string) => fetch(`${base}${path}${path.includes('?') ? '&' : '?'}token=test-token`)
    const post = (path: string, body: unknown) => fetch(`${base}${path}?token=test-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    try {
      expect((await fetch(`${base}/api/karaoke/library`)).status).toBe(401)
      expect((await (await get('/api/karaoke/library')).json()).directory).toBe(directory)
      const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8)
      await writeKaraokeStem(root, 'hq3', 'netease:1', (async function* () { yield wav })())
      const track = { provider: 'netease', source: 'netease', type: 'song', id: '1', name: '歌曲', artist: '艺人', artists: [], duration: 180000 }
      const saved = await post('/api/karaoke/library/save', { model: 'hq3', key: 'netease:1', track, directory })
      expect(saved.status).toBe(200)
      const item = await saved.json() as Accompaniment
      const audio = await get(`/api/local/audio?id=karaoke:${item.id}`)
      expect(audio.headers.get('Content-Type')).toBe('audio/wav')
      expect((await audio.arrayBuffer()).byteLength).toBe(48)
      expect((await (await get(`/api/local/lyric?id=karaoke:${item.id}`)).json()).original.id).toBe('1')
      expect((await get('/api/local/audio?id=karaoke:../../outside')).status).toBe(404)
      expect((await (await get('/api/karaoke/resources?model=hq3&duration=180000')).json()).canStart).toBe(true)
    } finally { server.close(); await rm(root, { recursive: true, force: true }) }
  })
})
