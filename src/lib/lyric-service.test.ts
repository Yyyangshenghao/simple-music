import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { lyricServiceMode, lyricServiceSources, searchGuestTracks } from './lyric-service'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'

vi.mock('./api', () => ({ api: { get: vi.fn() } }))

const providers = (netease: string, qq: string, apple = 'anonymous', enabled = true) => useProviderStore.setState({
  playbackOrder: ['apple', 'qq', 'netease'],
  byId: {
    netease: { enabled, auth: netease }, qq: { enabled, auth: qq }, apple: { enabled, auth: apple },
  } as never,
})

beforeEach(() => {
  vi.resetAllMocks()
  useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true } })
})

describe('歌词来源与播放平台分开', () => {
  it('已登录并参与播放用账号；否则按设置游客查询；Apple 只认账号', () => {
    providers('authenticated', 'anonymous')
    expect(lyricServiceMode('netease')).toBe('account')
    expect(lyricServiceMode('qq')).toBe('guest')
    expect(lyricServiceMode('apple')).toBeNull()
    providers('authenticated', 'authenticated', 'authenticated', false)
    expect(lyricServiceMode('netease')).toBe('guest')
    expect(lyricServiceMode('apple')).toBeNull()
    useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: true } })
    expect(lyricServiceMode('netease')).toBeNull()
  })

  it('启动时登录状态未确认，已启用平台先不按游客查询；停用平台照常游客', () => {
    providers('unknown', 'unknown')
    expect(lyricServiceMode('netease')).toBeNull()
    expect(lyricServiceSources()).toEqual([])
    providers('unknown', 'unknown', 'anonymous', false)
    expect(lyricServiceMode('qq')).toBe('guest')
  })

  it('参与平台按播放顺序在前，游客平台在后，不重复', () => {
    providers('anonymous', 'authenticated', 'authenticated')
    expect(lyricServiceSources()).toEqual(['apple', 'qq', 'netease'])
    providers('anonymous', 'anonymous')
    expect(lyricServiceSources()).toEqual(['netease', 'qq'])
    useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false } })
    expect(lyricServiceSources()).toEqual([])
  })

  it('游客搜索只发送关键词并标记 guest，结果补齐来源；上游错误不当作空结果', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ songs: [{ id: 1, name: '晴天' }] })
    expect(await searchGuestTracks('qq', '晴天 周杰伦')).toEqual([{ id: 1, name: '晴天', provider: 'qq', source: 'qq' }])
    expect(api.get).toHaveBeenCalledWith('/api/qq/search', { keywords: '晴天 周杰伦', limit: 20, guest: '1' }, { signal: undefined })
    vi.mocked(api.get).mockResolvedValueOnce({ songs: [], error: 'blocked' })
    await expect(searchGuestTracks('netease', 'x')).rejects.toThrow('blocked')
  })
})
