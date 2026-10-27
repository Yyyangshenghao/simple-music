import { describe, expect, it, vi } from 'vitest'
import { accompanimentOriginal, accompanimentTrack, accompanimentsForTrack, findAccompaniment } from './karaoke-library'
import { restoreLocalTrackUrls } from './local-track-urls'
import type { Accompaniment } from '../types/karaoke'
import type { Track } from '../types/domain'

vi.mock('./api', () => ({ api: { url: (path: string, params: Record<string, string>) => `http://127.0.0.1:9999${path}?${new URLSearchParams(params)}` } }))

describe('伴奏的播放身份', () => {
  it('保留原曲身份，并在重启后按原曲 ID 重建封面、按伴奏 ID 重建音频', () => {
    const item: Accompaniment = { id: 'a'.repeat(40), key: 'local:original', model: 'hq3', directory: '/songs', fileName: 'song.wav', bytes: 44, generatedAt: 1, available: true,
      track: { source: 'local', provider: 'local', type: 'song', id: 'original', name: '歌曲', artist: '艺人', artists: [], cover: 'http://127.0.0.1:1111/api/local/cover?id=original' } }
    const track = accompanimentTrack(item)
    expect(track.id).toBe(`karaoke:${item.id}`)
    expect(track.cover).toBe('http://127.0.0.1:9999/api/local/cover?id=original')
    const restored = restoreLocalTrackUrls({ ...track, cover: item.track.cover })
    expect(restored.url).toContain(`id=karaoke%3A${item.id}`)
    expect(restored.cover).toBe(track.cover)
    expect(accompanimentOriginal(restored)).toMatchObject({ id: 'original', source: 'local', cover: track.cover })
  })
})

describe('当前歌曲的伴奏识别', () => {
  const track: Track = { source: 'netease', provider: 'netease', type: 'song', id: 123, name: '歌曲', artist: '艺人', artists: [] }
  const item = (patch: Partial<Accompaniment> = {}): Accompaniment => ({
    id: 'a'.repeat(40), key: 'netease:123', model: 'hq3', track,
    directory: '/songs', fileName: 'song.wav', bytes: 44, generatedAt: 1, available: true, ...patch,
  })

  it('优先所选模型，其他版本按最近生成排序，跳过丢失文件', () => {
    const preferred = item()
    const latest = item({ model: 'kara2', generatedAt: 5 })
    const missing = item({ model: 'hq3-fp16', generatedAt: 10, available: false })
    expect(findAccompaniment(track, [latest, preferred, missing], 'hq3')).toBe(preferred)
    expect(findAccompaniment(track, [preferred, missing, latest], 'hq3-fp16')).toBe(latest)
    expect(findAccompaniment(track, [missing], 'hq3-fp16')).toBeNull()
    expect(accompanimentsForTrack(track, [preferred, missing, latest])).toEqual([missing, latest, preferred])
  })

  it('按来源及字符串化 ID 匹配，不把同名不同平台或不同录音当成同一首', () => {
    const saved = item({ track: { ...track, id: '123' } })
    expect(findAccompaniment(track, [saved], 'hq3')).toBe(saved)
    expect(findAccompaniment({ ...track, source: 'qq', provider: 'qq' }, [saved], 'hq3')).toBeNull()
    expect(findAccompaniment({ ...track, id: 124 }, [saved], 'hq3')).toBeNull()
    expect(findAccompaniment({ ...track, source: 'apple', provider: 'apple' }, [saved], 'hq3')).toBeNull()
  })

  it('QQ 可按同一 mid 识别，已在播放的伴奏按原曲匹配', () => {
    const qq: Track = { ...track, provider: 'qq', source: 'qq', mid: 'song-mid' }
    const saved = item({ track: qq })
    expect(findAccompaniment({ ...qq, id: 'other-id' }, [saved], 'hq3')).toBe(saved)
    expect(findAccompaniment(accompanimentTrack(saved), [saved], 'hq3')).toBe(saved)
  })
})

describe('点按麦克风的默认伴奏', () => {
  const track: Track = { source: 'netease', provider: 'netease', type: 'song', id: 123, name: '歌曲', artist: '艺人', artists: [] }
  const item = (id: string, patch: Partial<Accompaniment> = {}): Accompaniment => ({
    id: id.repeat(40), key: 'netease:123', model: 'hq3', track,
    directory: '/songs', fileName: 'song.wav', bytes: 44, generatedAt: 1, available: true, ...patch,
  })

  it('最近播放的版本优先于所选模型和最新生成，丢失文件即使播放过也跳过', () => {
    const old = item('a', { model: 'kara2', generatedAt: 1 })
    const preferred = item('b', { model: 'hq3', generatedAt: 2 })
    const newest = item('c', { model: 'hq3-fp16', generatedAt: 9 })
    const missing = item('d', { generatedAt: 10, available: false })
    const all = [old, preferred, newest, missing]
    expect(findAccompaniment(track, all, 'hq3', {})).toBe(preferred)
    expect(findAccompaniment(track, all, 'hq3', { [old.id]: 5 })).toBe(old)
    expect(findAccompaniment(track, all, 'hq3', { [old.id]: 5, [newest.id]: 8 })).toBe(newest)
    expect(findAccompaniment(track, all, 'hq3', { [missing.id]: 99, [old.id]: 5 })).toBe(old)
  })
})
