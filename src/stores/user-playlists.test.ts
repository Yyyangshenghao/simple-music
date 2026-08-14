import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePlaylistStore } from './playlist'
import { useProviderStore } from './providers'
import { neteaseService, qqService } from '../lib/service-registry'
import type { Playlist } from '../types/domain'

/**
 * 回归:loadUserPlaylists 曾写死网易端点,QQ 音源下「我的库→歌单」显示的是网易歌单,
 * 而 QQ 自己的 /api/qq/user/playlists 从未被调用。
 */

function pl(name: string, source: 'netease' | 'qq'): Playlist {
  return {
    provider: source, source, type: 'playlist', id: name, name,
    cover: '', trackCount: 0, playCount: 0,
  } as Playlist
}

describe('loadUserPlaylists 按显式平台取歌单', () => {
  beforeEach(() => {
    usePlaylistStore.setState({ playlists: [], playlistsSource: null })
    useProviderStore.setState((state) => ({
      byId: {
        netease: { ...state.byId.netease, enabled: true, auth: 'authenticated' },
        qq: { ...state.byId.qq, enabled: true, auth: 'authenticated' },
      },
      playbackOrder: ['netease', 'qq'],
    }))
    vi.restoreAllMocks()
  })

  it('网易音源走网易 service', async () => {
    const ne = vi.spyOn(neteaseService, 'getUserPlaylists').mockResolvedValue([pl('网易歌单', 'netease')])
    const qq = vi.spyOn(qqService, 'getUserPlaylists').mockResolvedValue([])

    await usePlaylistStore.getState().loadUserPlaylists('netease')

    expect(ne).toHaveBeenCalled()
    expect(qq).not.toHaveBeenCalled()
    expect(usePlaylistStore.getState().playlists.map((p) => p.name)).toEqual(['网易歌单'])
    expect(usePlaylistStore.getState().playlistsSource).toBe('netease')
  })

  it('QQ 音源走 QQ service,不再回落到网易', async () => {
    const ne = vi.spyOn(neteaseService, 'getUserPlaylists').mockResolvedValue([pl('网易歌单', 'netease')])
    const qq = vi.spyOn(qqService, 'getUserPlaylists').mockResolvedValue([pl('QQ歌单', 'qq')])

    await usePlaylistStore.getState().loadUserPlaylists('qq')

    expect(qq).toHaveBeenCalled()
    expect(ne).not.toHaveBeenCalled()
    expect(usePlaylistStore.getState().playlists.map((p) => p.name)).toEqual(['QQ歌单'])
    expect(usePlaylistStore.getState().playlistsSource).toBe('qq')
  })

  it('拉取失败时清空并标记音源(避免调用方按 length 无限重拉)', async () => {
    vi.spyOn(neteaseService, 'getUserPlaylists').mockRejectedValue(new Error('未登录'))

    await usePlaylistStore.getState().loadUserPlaylists('netease')

    expect(usePlaylistStore.getState().playlists).toEqual([])
    expect(usePlaylistStore.getState().playlistsSource).toBe('netease')
  })

  it('等待期间切换平台：丢弃晚到结果，不把 A 平台歌单挂到 B 平台下', async () => {
    let resolveNetease: (value: Playlist[]) => void = () => {}
    vi.spyOn(neteaseService, 'getUserPlaylists').mockImplementation(() => (
      new Promise<Playlist[]>((resolve) => { resolveNetease = resolve })
    ))
    vi.spyOn(qqService, 'getUserPlaylists').mockResolvedValue([pl('QQ歌单', 'qq')])

    const first = usePlaylistStore.getState().loadUserPlaylists('netease')
    await usePlaylistStore.getState().loadUserPlaylists('qq')
    resolveNetease([pl('网易歌单', 'netease')])
    await first

    expect(usePlaylistStore.getState().playlists.map((p) => p.name)).toEqual(['QQ歌单'])
    expect(usePlaylistStore.getState().playlistsSource).toBe('qq')
  })
})
