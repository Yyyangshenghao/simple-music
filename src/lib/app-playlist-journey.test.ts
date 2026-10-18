import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppPlaylistsStore, appPlaylistTrackKey } from '../stores/app-playlists'
import { useProviderStore } from '../stores/providers'
import type { ProviderId } from '../providers/types'
import type { Playlist, Track } from '../types/domain'
import type { PlaylistSkeleton } from './music-service'
import { resolveAppPlaylistTracks } from './batch-tracks'
import { appPlaylistPlaybackTracks, appPlaylistTrackState, type AppPlaylistPlaybackContext } from './app-playlist-playback'

const h = vi.hoisted(() => {
  function provider() {
    return {
      catalog: {
        getAlbumTracks: vi.fn<(id: unknown) => Promise<Track[]>>(),
        getPlaylistSkeleton: vi.fn<(id: unknown) => Promise<PlaylistSkeleton>>(),
        getTracksByIds: vi.fn<(ids: unknown[]) => Promise<Track[]>>(),
      },
      playlistWriter: {
        getPlaylistManagementSession: vi.fn(), inspectPlatformPlaylist: vi.fn(), mutatePlatformPlaylist: vi.fn(),
        findUserPlaylistsByName: vi.fn(), getPlaylistWithDescription: vi.fn(), createPlaylist: vi.fn(),
        replacePlaylistTracks: vi.fn(), updatePlaylistDescription: vi.fn(),
      },
    }
  }
  const providers = { netease: provider(), qq: provider(), apple: provider() }
  return { providers, providerFor: vi.fn((source: ProviderId) => providers[source]) }
})

vi.mock('../providers/registry', () => ({ providerFor: h.providerFor }))
vi.mock('./api', () => ({ api: { url: (path: string, params: { id: string }) => `http://current${path}?id=${params.id}` } }))

const sources = ['netease', 'qq', 'apple'] as const
const song = (source: Track['source'], id: unknown = 1, extra: Partial<Track> = {}): Track => ({
  provider: source, source, type: 'song', id, name: `${source} 歌曲`, artist: '艺人', artists: [{ id: 9, name: '艺人' }], ...extra,
})
const collection = (source: ProviderId, type = 'playlist'): Playlist => ({
  provider: source, source, type, id: `${source}-collection`, name: `${source} 收藏`, cover: '', creator: '', trackCount: 3, playCount: 0,
})

function archive() {
  let raw: string | null = null
  const storage = { getItem: vi.fn(() => raw), setItem: vi.fn((_key: string, value: string) => { raw = value }) }
  const open = () => createAppPlaylistsStore(() => storage, () => 'aggregate')
  return { storage, open, read: () => raw }
}

function playback(localTracks: Track[] = []): AppPlaylistPlaybackContext {
  return { providers: useProviderStore.getState().byId, localTracks: new Map(localTracks.map(track => [String(track.id), track])), offline: {} }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('应用歌单跨平台聚合旅程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderStore.setState({ byId: {
      netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' }, apple: { enabled: true, auth: 'authenticated', playbackAvailable: true },
    } })
    for (const source of sources) {
      h.providers[source].catalog.getAlbumTracks.mockReset().mockResolvedValue([])
      h.providers[source].catalog.getPlaylistSkeleton.mockReset().mockResolvedValue({ trackIds: [], tracks: [] })
      h.providers[source].catalog.getTracksByIds.mockReset().mockResolvedValue([])
    }
  })

  afterEach(() => {
    for (const source of sources) {
      for (const method of Object.values(h.providers[source].playlistWriter)) expect(method).not.toHaveBeenCalled()
    }
  })

  it('分批收藏四源歌曲并重启恢复，跨源同 ID 共存，同源数字/字符串 ID 去重，保留受限歌曲及播放身份', async () => {
    const disk = archive()
    const store = disk.open()
    const id = store.getState().create('跨平台通勤')
    for (const source of sources) useProviderStore.getState().setEnabled(source, false)
    const batches = [
      [song('netease', 1, { url: 'https://temporary/audio' }), song('qq', 1, { mid: 'qq-mid', qqId: 123, songmid: 'qq-songmid' })],
      [song('apple', 'i.1', { appleLibrary: true, catalogId: '123' }), song('local', 1, { url: 'http://old/audio?token=old', cover: 'http://old/cover?token=old' }), song('netease', '1')],
      [song('qq', '1'), song('qq', 2, { playable: false })],
    ]
    const added = []
    for (const batch of batches) {
      added.push(store.getState().addTracks(id, await resolveAppPlaylistTracks(batch, [], new AbortController().signal)))
    }
    expect(added).toEqual([2, 2, 1])
    const restored = disk.open().getState().items[0]
    expect(restored).toEqual(store.getState().items[0])
    expect(restored.tracks.map(appPlaylistTrackKey)).toEqual(['netease:1', 'qq:1', 'apple:i.1', 'local:1', 'qq:2'])
    expect(restored.tracks).toMatchObject([
      { id: '1' }, { id: '1', mid: 'qq-mid', qqId: 123, songmid: 'qq-songmid' },
      { id: 'i.1', appleLibrary: true, catalogId: '123' }, { id: '1', cover: 'local-cover' }, { playable: false },
    ])
    expect(disk.read()).not.toContain('http')
    expect(h.providerFor).not.toHaveBeenCalled()
  })

  it('停用、登录失效、Apple 会话断开及本地缺失只影响当前播放，恢复后可播；整理收藏与播放队列相互独立', () => {
    const disk = archive()
    disk.open().getState().create('跨平台通勤', [song('netease'), song('qq'), song('apple'), song('local'), song('qq', 2, { playable: false })])
    const store = disk.open()
    const saved = store.getState().items[0]
    const before = disk.read()
    useProviderStore.getState().setEnabled('netease', false)
    useProviderStore.getState().setAccountState('qq', 'expired', undefined, { preserveEnabled: true })
    useProviderStore.getState().setPlaybackAvailability('apple', false, '连接已断开')
    const unavailable = playback()
    expect(saved.tracks.map(track => appPlaylistTrackState(track, unavailable).status)).toEqual([
      '平台已停用', '登录已失效', '平台暂不可用', '本地文件不存在', '曲目暂不可用',
    ])
    expect(appPlaylistPlaybackTracks(saved.tracks, unavailable)).toEqual([])
    expect(disk.read()).toBe(before)
    expect(disk.open().getState().items[0]).toEqual(saved)

    useProviderStore.getState().setEnabled('netease', true)
    useProviderStore.getState().setAccountState('qq', 'authenticated')
    useProviderStore.getState().setPlaybackAvailability('apple', true)
    const currentLocal = song('local', '1', { name: '当前本地文件', cover: 'local-cover' })
    const queue = appPlaylistPlaybackTracks(saved.tracks, playback([currentLocal]))
    expect(queue.map(appPlaylistTrackKey)).toEqual(['netease:1', 'qq:1', 'apple:1', 'local:1'])
    expect(queue[3]).toMatchObject({ name: '当前本地文件', url: 'http://current/api/local/audio?id=1', cover: 'http://current/api/local/cover?id=1' })
    const queueSnapshot = JSON.parse(JSON.stringify(queue))
    store.getState().moveTrack(saved.id, 'apple:1', -1)
    store.getState().removeTracks(saved.id, ['netease:1'])
    store.getState().rename(saved.id, '整理后的通勤')
    expect(queue).toEqual(queueSnapshot)
    queue[1].artists[0].name = '队列临时信息'
    queue.reverse()
    expect(store.getState().items[0].tracks.map(appPlaylistTrackKey)).toEqual(['apple:1', 'qq:1', 'local:1', 'qq:2'])
    expect(disk.open().getState().items[0].tracks.every(track => track.artists[0].name === '艺人')).toBe(true)
  })

  it('平台离线后仅放行已确认的网易/QQ 缓存，Apple 不能借缓存绕过受保护会话，收藏始终完整', () => {
    const disk = archive()
    disk.open().getState().create('离线通勤', [song('netease'), song('qq'), song('apple'), song('qq', 2), song('netease', 2)])
    const saved = disk.open().getState().items[0]
    for (const source of sources) useProviderStore.getState().setEnabled(source, false)
    const ctx = playback()
    ctx.offline = {
      'netease:1': { source: 'netease', id: '1', state: 'cached', entryId: 'netease-audio' },
      'qq:1': { source: 'qq', id: '1', state: 'pinned', entryId: 'qq-audio' },
      'apple:1': { source: 'qq', id: '1', state: 'pinned', entryId: 'ordinary-audio' },
      'qq:2': { source: 'qq', id: '2', state: 'missing', entryId: 'removed-audio' },
      'netease:2': { source: 'netease', id: '2', state: 'cached' },
    }
    expect(appPlaylistPlaybackTracks(saved.tracks, ctx).map(appPlaylistTrackKey)).toEqual(['netease:1', 'qq:1'])
    useProviderStore.getState().setAccountState('apple', 'authenticated')
    useProviderStore.getState().setEnabled('apple', true)
    useProviderStore.getState().setPlaybackAvailability('apple', false)
    // 只有恢复官网受保护播放会话后，Apple 收藏才重新进入队列。
    expect(appPlaylistPlaybackTracks(saved.tracks, { ...ctx, providers: useProviderStore.getState().byId }).map(appPlaylistTrackKey)).toEqual(['netease:1', 'qq:1'])
    useProviderStore.getState().setPlaybackAvailability('apple', true)
    expect(appPlaylistPlaybackTracks(saved.tracks, { ...ctx, providers: useProviderStore.getState().byId }).map(appPlaylistTrackKey)).toEqual(['netease:1', 'qq:1', 'apple:1'])
    expect(disk.open().getState().items[0]).toEqual(saved)
  })

  it('同次导入网易歌单、QQ 专辑及 Apple 歌单按各自目录展开，补详情不串源，缺失曲目原身份可重启恢复', async () => {
    h.providers.netease.catalog.getPlaylistSkeleton.mockResolvedValue({ trackIds: [1, 2, 3], tracks: [song('netease')] })
    h.providers.netease.catalog.getTracksByIds.mockResolvedValue([song('netease', 2, { name: '补全的网易歌曲' }), song('qq', 3)])
    h.providers.qq.catalog.getAlbumTracks.mockResolvedValue([song('qq'), song('qq', 2, { playable: false })])
    h.providers.apple.catalog.getPlaylistSkeleton.mockResolvedValue({ trackIds: ['i.1', 'i.missing'], tracks: [song('apple', 'i.1', { appleLibrary: true, catalogId: '123' })] })
    const disk = archive()
    const store = disk.open()
    const id = store.getState().create('聚合的收藏', [song('local')])
    const tracks = await resolveAppPlaylistTracks([], [collection('netease'), collection('qq', 'album'), collection('apple')], new AbortController().signal)
    expect(store.getState().addTracks(id, tracks)).toBe(7)
    expect(h.providers.netease.catalog.getPlaylistSkeleton).toHaveBeenCalledWith('netease-collection')
    expect(h.providers.qq.catalog.getAlbumTracks).toHaveBeenCalledWith('qq-collection')
    expect(h.providers.apple.catalog.getPlaylistSkeleton).toHaveBeenCalledWith('apple-collection')
    expect(h.providers.netease.catalog.getTracksByIds).toHaveBeenCalledWith([2, 3])
    expect(h.providers.apple.catalog.getTracksByIds).toHaveBeenCalledWith(['i.missing'])
    expect(h.providers.qq.catalog.getTracksByIds).not.toHaveBeenCalled()
    expect(h.providers.qq.catalog.getPlaylistSkeleton).not.toHaveBeenCalled()
    expect(h.providers.netease.catalog.getAlbumTracks).not.toHaveBeenCalled()
    const restored = disk.open().getState().items[0]
    expect(restored.tracks.map(appPlaylistTrackKey)).toEqual(['local:1', 'netease:1', 'netease:2', 'netease:3', 'qq:1', 'qq:2', 'apple:i.1', 'apple:i.missing'])
    expect(restored.tracks[2].name).toBe('补全的网易歌曲')
    expect(restored.tracks.filter(track => track.pending).map(appPlaylistTrackKey)).toEqual(['netease:3', 'apple:i.missing'])
    expect(restored.tracks[5].playable).toBe(false)
    expect(restored.tracks[6]).toMatchObject({ appleLibrary: true, catalogId: '123' })
  })

  it.each([
    ['集合展开', '换号'], ['集合展开', '取消'], ['详情补全', '换号'], ['详情补全', '取消'],
  ] as const)('%s 期间%s，迟到结果不能保存到聚合收藏或继续读取后续平台', async (stage, action) => {
    const disk = archive()
    const store = disk.open()
    const id = store.getState().create('已有收藏', [song('local')])
    const original = disk.read()
    const controller = new AbortController()
    const album = deferred<Track[]>()
    const details = deferred<Track[]>()
    h.providers.netease.catalog.getAlbumTracks.mockReturnValue(album.promise)
    h.providers.netease.catalog.getTracksByIds.mockReturnValue(details.promise)
    const pending = stage === '详情补全'
    const task = resolveAppPlaylistTracks(pending ? [song('netease', 1, { pending: true })] : [], pending ? [] : [collection('netease', 'album'), collection('apple', 'album')], controller.signal)
      .then(tracks => store.getState().addTracks(id, tracks))
    const rejected = expect(task).rejects.toThrow(action === '取消' ? 'Aborted' : '账号或平台状态已变化')
    expect(pending ? h.providers.netease.catalog.getTracksByIds : h.providers.netease.catalog.getAlbumTracks).toHaveBeenCalledTimes(1)
    if (action === '取消') controller.abort()
    else useProviderStore.getState().setAccountState('netease', 'authenticated', { nickname: '新账号', avatar: '' })
    if (pending) details.resolve([song('netease')])
    else album.resolve([song('netease')])
    await rejected
    expect(disk.read()).toBe(original)
    expect(disk.open().getState().items[0].tracks.map(appPlaylistTrackKey)).toEqual(['local:1'])
    expect(h.providers.apple.catalog.getAlbumTracks).not.toHaveBeenCalled()
    expect(h.providers.qq.catalog.getPlaylistSkeleton).not.toHaveBeenCalled()
  })
})
