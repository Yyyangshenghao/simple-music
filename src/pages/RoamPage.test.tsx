import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoamPlaylist } from '../stores/roam'
import type { Track } from '../types/domain'
import { mergeSavedPlaylist, RoamPage } from './RoamPage'

const { providerState, roamState, settingsState } = vi.hoisted(() => ({
  providerState: {
    byId: {
      netease: { enabled: true, auth: 'authenticated' as const },
      qq: { enabled: true, auth: 'authenticated' as const },
    },
    sourceBadgeMode: 'dynamic' as const,
  },
  roamState: {
    playlist: null as RoamPlaylist | null,
    localPlaylist: null as RoamPlaylist | null,
    entries: [],
    mode: 'hot' as const,
    scope: 'all' as const,
    generating: false,
    loading: false,
    error: null,
    confirmArtists: vi.fn(),
    setMode: vi.fn(),
    setScope: vi.fn(),
    generate: vi.fn(),
    reset: vi.fn(),
    clearSuggestions: vi.fn(),
    ensureNeteaseHydrated: vi.fn(),
  },
  settingsState: {
    neteaseLoggedIn: true,
    audioQuality: 'max' as const,
    performance: { gradientTextMotion: false },
  },
}))

vi.mock('../stores/providers', () => ({
  useProviderStore: Object.assign(
    (selector: (state: typeof providerState) => unknown) => selector(providerState),
    { getState: () => providerState, subscribe: vi.fn(() => vi.fn()) }
  ),
}))

vi.mock('../stores/roam', () => ({
  todayKey: () => '2026-08-14',
  useRoamStore: Object.assign(
    (selector: (state: typeof roamState) => unknown) => selector(roamState),
    { getState: () => roamState }
  ),
}))

vi.mock('../stores/settings', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
    { getState: () => settingsState, subscribe: vi.fn(() => vi.fn()) }
  ),
}))

function track(source: 'netease' | 'qq', id: string): Track {
  return {
    provider: source,
    source,
    type: 'song',
    id,
    name: `旧曲目-${id}`,
    artist: '测试歌手',
    artists: [],
  }
}

describe('RoamPage 已保存歌单入口', () => {
  beforeEach(() => {
    roamState.playlist = {
      date: '2000-01-01',
      source: 'mixed',
      mode: 'hot',
      artists: [{ name: '测试歌手' }],
      tracks: [track('netease', '1'), track('qq', '2')],
    }
    roamState.localPlaylist = roamState.playlist
  })

  it('发现本地混合歌单时先让用户选择，不直接进入曲目结果', () => {
    const html = renderToStaticMarkup(<RoamPage />)

    expect(html).toContain('SAVED ROAM')
    expect(html).toContain('继续听')
    expect(html).toContain('重新生成')
    expect(html).toContain('保存在本机')
    expect(html).not.toContain('旧曲目-1')
    expect(html).not.toContain('旧曲目-2')
  })

  it('本地存档和网易云存档可并列保留，同类新结果只覆盖各自槽位', () => {
    const local = roamState.playlist as RoamPlaylist
    const remote: RoamPlaylist = {
      date: '2026-08-14',
      source: 'netease',
      mode: 'hot',
      artists: [{ name: '远端歌手' }],
      tracks: [track('netease', 'remote-1')],
    }
    const refreshedLocal: RoamPlaylist = {
      ...local,
      date: '2026-08-14',
      tracks: [track('qq', 'local-new')],
    }

    const saved = mergeSavedPlaylist(
      mergeSavedPlaylist([{ slot: 'local', playlist: local }], remote, 'netease'),
      refreshedLocal,
      'local'
    )

    expect(saved).toHaveLength(2)
    expect(saved).toContainEqual({ slot: 'netease', playlist: remote })
    expect(saved).toContainEqual({ slot: 'local', playlist: refreshedLocal })
    expect(saved).not.toContainEqual({ slot: 'local', playlist: local })
  })

  it('页面重建时仍可从独立槽位同时展示本地与网易云存档', () => {
    roamState.playlist = {
      date: '2026-08-14',
      source: 'netease',
      mode: 'hot',
      artists: [{ name: '远端歌手' }],
      tracks: [track('netease', 'remote-1')],
    }

    const html = renderToStaticMarkup(<RoamPage />)

    expect(html.match(/SAVED ROAM/g)).toHaveLength(2)
    expect(html).toContain('来自网易云「每日漫游」')
    expect(html).toContain('保存在本机')
  })
})
