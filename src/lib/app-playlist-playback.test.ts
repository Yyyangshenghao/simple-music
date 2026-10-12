import { describe, expect, it, vi } from 'vitest'
import { appPlaylistPlaybackTracks, appPlaylistTrackState, type AppPlaylistPlaybackContext } from './app-playlist-playback'
import type { OfflineCacheStatus } from './offline-cache'
import type { Track } from '../types/domain'

vi.mock('./api', () => ({ api: { url: (path: string, params: { id: string }) => `http://current${path}?id=${params.id}` } }))
const song = (source: Track['source'], id = '1'): Track => ({ provider: source, source, type: 'song', id, name: '歌曲', artist: '', artists: [] })
function context(): AppPlaylistPlaybackContext {
  return { providers: {
    netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: false, auth: 'expired' }, apple: { enabled: false, auth: 'anonymous' },
  }, localTracks: new Map([['1', { ...song('local'), name: '当前文件', cover: 'local-cover' }]]), offline: {} }
}

describe('应用歌单播放边界', () => {
  it('超过全局缓存上限的完整离线歌单仍全部可播', () => {
    const tracks = Array.from({ length: 2050 }, (_, index) => song('qq', String(index)))
    const snapshot = Object.fromEntries(tracks.map(track => [`qq:${track.id}`, { source: 'qq', id: String(track.id), state: 'pinned', entryId: `cache-${track.id}` } as OfflineCacheStatus]))
    const ctx = { ...context(), offline: snapshot }
    expect(appPlaylistPlaybackTracks(tracks, ctx)).toHaveLength(2050)
  })
  it('本地文件按当前索引和当前资源地址播放，缺失时保留收藏并标记不可用', () => {
    const ctx = context()
    const current = appPlaylistTrackState(song('local'), ctx)
    expect(current).toMatchObject({ available: true, track: { name: '当前文件', url: 'http://current/api/local/audio?id=1', cover: 'http://current/api/local/cover?id=1' } })
    expect(appPlaylistTrackState(song('local', 'missing'), ctx)).toMatchObject({ available: false, status: '本地文件不存在' })
    expect(appPlaylistTrackState(song('local'), { ...ctx, localTracks: null, localError: '本地索引读取失败' })).toMatchObject({ available: false, status: '本地索引读取失败' })
  })
  it('退出账号、平台停用与曲目失效均给出状态；Apple 不能通过普通离线缓存绕过会话', () => {
    const ctx = context()
    expect(appPlaylistTrackState(song('qq'), ctx).status).toBe('平台已停用')
    ctx.providers.qq.enabled = true
    expect(appPlaylistTrackState(song('qq'), ctx).status).toBe('登录已失效')
    ctx.providers.apple.enabled = true
    expect(appPlaylistTrackState(song('apple'), ctx).status).toBe('请先登录')
    ctx.providers.apple.auth = 'authenticated'
    ctx.providers.apple.playbackAvailable = false
    expect(appPlaylistTrackState(song('apple'), ctx).available).toBe(false)
    expect(appPlaylistTrackState({ ...song('netease'), playable: false }, ctx).status).toBe('曲目暂不可用')
  })
  it('网易/QQ 的已确认离线音频可在平台停用后播放，Apple 仍走独立受保护会话', () => {
    const ctx = context()
    ctx.offline['qq:1'] = { source: 'qq', id: '1', state: 'pinned', entryId: 'cache' }
    expect(appPlaylistTrackState(song('qq'), ctx)).toMatchObject({ available: true, status: '可离线播放' })
    expect(appPlaylistPlaybackTracks([song('qq'), song('apple')], ctx).map(track => track.source)).toEqual(['qq'])
    ctx.providers.apple = { enabled: true, auth: 'authenticated' }
    expect(appPlaylistPlaybackTracks([song('qq'), song('apple')], ctx).map(track => track.source)).toEqual(['qq', 'apple'])
  })
  it('播放只复制当前可用曲目，保留顺序和来源；修改队列不改变收藏', () => {
    const ctx = context()
    const tracks = [song('netease'), song('qq'), song('local')]
    const queue = appPlaylistPlaybackTracks(tracks, ctx)
    expect(queue.map(track => track.source)).toEqual(['netease', 'local'])
    queue[0].name = '队列元数据'
    queue.reverse()
    expect(tracks[0].name).toBe('歌曲')
    expect(tracks.map(track => track.source)).toEqual(['netease', 'qq', 'local'])
  })
})
