import { beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { queryLyricsSource } from './lyrics-source-query'
import { clearProviderRequestCache } from './provider-request-cache'
import { clearBilibiliSongIdentityCache, getBilibiliSongCandidates, resolveBilibiliSongIdentity } from './bilibili-song-identity'
import { useBilibiliCoverStore } from '../stores/bilibili-covers'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'

const h = vi.hoisted(() => ({ accountSearch: vi.fn() }))
vi.mock('./api', () => ({ api: { get: vi.fn() } }))
vi.mock('../providers/registry', () => ({ providerFor: () => ({ catalog: { searchTracks: h.accountSearch } }) }))

const video: Track = {
  id: 'BV-guest', source: 'bilibili', provider: 'bilibili', type: 'song',
  name: '周杰伦《晴天》', videoTitle: '周杰伦《晴天》', artist: 'UP 主', artists: [], duration: 269_000,
}
const song: Track = {
  id: 186016, source: 'netease', provider: 'netease', type: 'song', name: '晴天',
  artist: '周杰伦', artists: [{ id: 6452, name: '周杰伦' }], duration: 269_000, cover: 'https://example.com/album.jpg',
}

beforeEach(() => {
  vi.resetAllMocks()
  clearBilibiliSongIdentityCache()
  clearProviderRequestCache()
  useBilibiliCoverStore.setState({ entries: {} })
  useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false },
    lyricsPlatformSources: { netease: false, qq: false, apple: false, qishui: false } })
  const byId = useProviderStore.getState().byId
  useProviderStore.setState({ playbackOrder: [], byId: Object.fromEntries(Object.entries(byId)
    .map(([source, state]) => [source, { ...state, enabled: false, auth: 'anonymous' }])) as typeof byId })
  vi.mocked(api.get).mockImplementation(async path => ({ songs: path === '/api/search' ? [song] : [] }) as never)
})

it('关闭所有平台和游客歌词开关，仍固定以游客搜索并补齐 B 站专辑封面', async () => {
  const result = await resolveBilibiliSongIdentity(video)
  expect(result?.track.id).toBe(song.id)
  expect(useBilibiliCoverStore.getState().entries['bilibili:BV-guest']?.cover).toBe(song.cover)
  for (const path of ['/api/search', '/api/qq/search']) {
    expect(api.get).toHaveBeenCalledWith(path, expect.objectContaining({ guest: '1', keywords: '晴天 周杰伦' }), expect.anything())
  }
  expect(h.accountSearch).not.toHaveBeenCalled()
})

it('已登录账号也始终使用游客接口，切换平台设置复用同一识别结果', async () => {
  useProviderStore.setState({ byId: { ...useProviderStore.getState().byId, netease: { enabled: true, auth: 'authenticated' } } })
  const result = await resolveBilibiliSongIdentity(video)
  const calls = vi.mocked(api.get).mock.calls.length
  useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true },
    lyricsPlatformSources: { netease: true, qq: true, apple: true, qishui: true } })
  expect(await resolveBilibiliSongIdentity(video)).toBe(result)
  expect(await getBilibiliSongCandidates(video)).toEqual([])
  expect(api.get).toHaveBeenCalledTimes(calls)
  expect(vi.mocked(api.get).mock.calls.every(([, params]) => params?.guest === '1')).toBe(true)
  expect(h.accountSearch).not.toHaveBeenCalled()
})


it.each(['全部关闭', '已登录'])('%s 时，B 站从游客搜索到原生歌词的完整链路仍使用 guest=1', async state => {
  if (state === '已登录') useProviderStore.setState({ byId: { ...useProviderStore.getState().byId, netease: { enabled: true, auth: 'authenticated' } } })
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/api/lyric') return { lyric: '[00:01.00]游客歌词正文' } as never
    return { songs: path === '/api/search' ? [song] : [] } as never
  })
  const result = await queryLyricsSource(video, 'netease', [])
  expect(result).toMatchObject({ status: 'ready', match: { id: 186016 }, result: { main: [{ time: 1, text: '游客歌词正文' }] } })
  expect(api.get).toHaveBeenCalledWith('/api/lyric', { id: '186016', guest: '1' }, expect.anything())
  expect(h.accountSearch).not.toHaveBeenCalled()
})
