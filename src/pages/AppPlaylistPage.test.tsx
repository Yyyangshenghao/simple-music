import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppPlaylistPage } from './AppPlaylistPage'
import type { Track } from '../types/domain'
import type { OfflineCacheStatus } from '../lib/offline-cache'

const h = vi.hoisted(() => ({
  index: 0, states: [] as unknown[], effects: [] as Array<() => (() => void) | void>, cleanups: [] as Array<() => void>,
  fetch: vi.fn(), tracks: [] as Track[], offline: { revision: 0, byKey: {} as Record<string, OfflineCacheStatus> },
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.index++
    if (!(index in h.states)) h.states[index] = initial
    return [h.states[index], (value: unknown) => { h.states[index] = value }]
  },
  useEffect: (effect: () => (() => void) | void) => { h.effects.push(effect) },
  useMemo: (factory: () => unknown) => factory(), useRef: () => ({ current: null }),
}))
vi.mock('../stores/app-playlists', async importOriginal => ({
  ...await importOriginal<typeof import('../stores/app-playlists')>(),
  useAppPlaylistsStore: (selector: (state: unknown) => unknown) => selector({ items: [{ id: 'app', name: '应用歌单', tracks: h.tracks }], error: '' }),
}))
const providers = { netease: { enabled: false, auth: 'anonymous' }, qq: { enabled: false, auth: 'anonymous' }, apple: { enabled: false, auth: 'anonymous' } }
vi.mock('../stores/providers', () => ({ useProviderStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector({ byId: providers }), { getState: () => ({ byId: providers }) },
) }))
vi.mock('../stores/offline-cache', () => ({ useOfflineCacheStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector(h.offline), { getState: () => h.offline },
) }))
vi.mock('../lib/offline-cache', () => ({ fetchOfflineStatuses: h.fetch }))
vi.mock('../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({}) } }))
vi.mock('../stores/navigation', () => ({ useNavigationStore: { getState: () => ({}) } }))
vi.mock('../components/Explore/TrackRow', () => ({ TrackRow: () => null }))
vi.mock('../components/ui/ScrollArea', () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('../components/ui/VirtualList', () => ({ VirtualList: () => null }))

function render() { h.index = 0; return renderToStaticMarkup(<AppPlaylistPage id="app" />) }

describe('应用歌单完整离线状态快照', () => {
  beforeEach(() => {
    vi.clearAllMocks(); h.states = []; h.effects = []; h.offline = { revision: 0, byKey: {} }
    h.tracks = [{ source: 'qq', provider: 'qq', type: 'song', id: '1', name: '歌曲', artist: '', artists: [] }]
  })
  afterEach(() => h.cleanups.splice(0).forEach(cleanup => cleanup()))
  it('行查询的旧 pinned 迟到也不能覆盖完整查询的 missing', async () => {
    h.fetch.mockResolvedValue([{ source: 'qq', id: '1', state: 'missing' }])
    render()
    h.effects.splice(0).forEach(effect => { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup) })
    await Promise.resolve()
    h.offline.byKey['qq:1'] = { source: 'qq', id: '1', state: 'pinned', entryId: 'old-file' }
    expect(render()).toContain('当前可播放 0 首')
    expect(h.fetch).toHaveBeenCalledWith(h.tracks, expect.any(AbortSignal))
  })
  it('全局徽标缓存已淘汰时仍使用完整查询结果，变更 revision 后立即失效', async () => {
    h.fetch.mockResolvedValue([{ source: 'qq', id: '1', state: 'pinned', entryId: 'file' }])
    render()
    h.effects.splice(0).forEach(effect => { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup) })
    await Promise.resolve()
    expect(render()).toContain('当前可播放 1 首')
    h.offline.revision++
    expect(render()).toContain('当前可播放 0 首')
  })
})
