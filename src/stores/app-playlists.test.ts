import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_PLAYLISTS_KEY, appPlaylistTrackKey, createAppPlaylistsStore } from './app-playlists'
import type { Track } from '../types/domain'

const song = (source: Track['source'], id: unknown = 1): Track => ({ provider: source, source, type: 'song', id, name: '歌曲', artist: '艺人', artists: [] })
let archive: string | null
const storage = { getItem: vi.fn(() => archive), setItem: vi.fn((_key: string, value: string) => { archive = value }) }
const makeStore = () => createAppPlaylistsStore(() => storage, () => 'test-playlist')

describe('应用歌单独立存档', () => {
  beforeEach(() => { archive = null; vi.clearAllMocks() })

  it('同时保存四种来源，按 source + String(id) 去重且保留加入顺序与不可播曲目', () => {
    const store = makeStore()
    const id = store.getState().create('  通勤  ', [song('netease'), song('qq'), song('apple'), song('local'), song('netease', '1'), { ...song('qq', 2), playable: false }])
    expect(store.getState().items[0].name).toBe('通勤')
    expect(store.getState().items[0].tracks.map(appPlaylistTrackKey)).toEqual(['netease:1', 'qq:1', 'apple:1', 'local:1', 'qq:2'])
    expect(store.getState().addTracks(id, [song('local'), song('local', 2)])).toBe(1)
    expect(store.getState().items[0].tracks.at(-1)?.source).toBe('local')
    expect(makeStore().getState().items).toEqual(store.getState().items)
  })

  it('剥离临时音频和本地资源地址，保留 QQ/Apple 播放身份', () => {
    const store = makeStore()
    store.getState().create('混合', [
      { ...song('qq'), mid: 'mid', qqId: 123, songmid: 'songmid', url: 'https://audio.test/secret' },
      { ...song('apple', 'i.1'), appleLibrary: true, catalogId: '123', url: 'apple-music:123' },
      { ...song('local'), url: 'http://127.0.0.1:123/audio?token=secret', cover: 'http://127.0.0.1:123/cover?token=secret' },
    ])
    expect(archive).not.toContain('secret')
    expect(store.getState().items[0].tracks).toMatchObject([
      { mid: 'mid', qqId: 123, songmid: 'songmid' }, { appleLibrary: true, catalogId: '123' }, { cover: 'local-cover' },
    ])
    expect(store.getState().items[0].tracks.every(track => !track.url)).toBe(true)
  })

  it('编辑顺序、移除及删除均不修改交给播放队列的旧快照或调用方输入', () => {
    const tracks = [song('local', 1), song('netease', 2), song('apple', 3)]
    const store = makeStore()
    const id = store.getState().create('原名称', tracks)
    const queue = store.getState().items[0].tracks
    tracks[0].name = '外部修改'
    expect(queue[0].name).toBe('歌曲')
    store.getState().moveTrack(id, 'apple:3', -1)
    store.getState().rename(id, '新名称')
    expect(store.getState().items[0].tracks.map(appPlaylistTrackKey)).toEqual(['local:1', 'apple:3', 'netease:2'])
    store.getState().removeTracks(id, ['local:1'])
    expect(store.getState().items[0].tracks.map(appPlaylistTrackKey)).toEqual(['apple:3', 'netease:2'])
    store.getState().remove(id)
    expect(makeStore().getState().items).toEqual([])
    expect(queue.map(appPlaylistTrackKey)).toEqual(['local:1', 'netease:2', 'apple:3'])
  })

  it('首尾移动及重复加入不写盘；不存在的歌单不能被迟到结果重建', () => {
    const store = makeStore()
    const id = store.getState().create('列表', [song('local')])
    storage.setItem.mockClear()
    store.getState().moveTrack(id, 'local:1', -1)
    store.getState().moveTrack(id, 'local:1', 1)
    expect(store.getState().addTracks(id, [song('local')])).toBe(0)
    expect(storage.setItem).not.toHaveBeenCalled()
    store.getState().remove(id)
    expect(() => store.getState().addTracks(id, [song('qq')])).toThrow('已被删除')
  })

  it('写入失败时不发布变更，旧存档和快照保持完整', () => {
    const store = makeStore()
    const id = store.getState().create('列表', [song('local')])
    const previous = store.getState().items
    const raw = archive
    storage.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError') })
    expect(() => store.getState().addTracks(id, [song('apple')])).toThrow('保存失败')
    expect(store.getState().items).toBe(previous)
    expect(archive).toBe(raw)
  })

  it.each(['{broken', '{"version":2,"items":[]}', '{"version":1,"items":[{}]}'])('损坏或未知版本存档不覆盖：%s', raw => {
    archive = raw
    const store = makeStore()
    expect(store.getState().error).toContain('原存档已保留')
    expect(() => store.getState().create('新列表')).toThrow('读取失败')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(archive).toBe(raw)
    archive = JSON.stringify({ version: 1, items: [] })
    store.getState().reload()
    expect(store.getState().error).toBe('')
  })

  it('空白名称和无效曲目不落盘', () => {
    const store = makeStore()
    expect(() => store.getState().create('  ')).toThrow('名称')
    expect(() => store.getState().create('列表', [{ ...song('local'), id: undefined }])).toThrow('曲目信息')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.getItem).toHaveBeenCalledWith(APP_PLAYLISTS_KEY)
  })
  it('QQ与网易云按各自账号保存关联，旧存档兼容，坏QQ关联保留原档', () => {
    const store = makeStore()
    const id = store.getState().create('歌单', [{ ...song('qq'), qqId: 123, songType: 1 }])
    store.getState().recordNeteaseSync(id, '7', { playlistId: '100' })
    store.getState().recordQQSync(id, '7', { playlistId: '900', syncedContent: 'content', syncedAt: 5 })
    store.getState().recordQQSync(id, '8', { playlistId: '901' })
    expect(makeStore().getState().items[0]).toMatchObject({ neteaseSync: { '7': { playlistId: '100' } },
      qqSync: { '7': { playlistId: '900', syncedContent: 'content' }, '8': { playlistId: '901' } }, tracks: [{ songType: 1 }] })
    const broken = JSON.parse(archive!)
    broken.items[0].qqSync['7'].playlistId = 'qq-liked:201'
    archive = JSON.stringify(broken)
    const original = archive
    expect(makeStore().getState().error).toContain('原存档已保留')
    expect(archive).toBe(original)
  })
})
