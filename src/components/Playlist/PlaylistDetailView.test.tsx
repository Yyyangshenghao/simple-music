import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBatchTracks } from '../../lib/batch-tracks'
import { PlaylistDetailView } from './PlaylistDetailView'
import type { BatchTrackActions } from './BatchTrackActions'
import type { Playlist, Track } from '../../types/domain'

const h = vi.hoisted(() => ({
  batch: undefined as Parameters<typeof BatchTrackActions>[0] | undefined,
  skeleton: vi.fn(),
  preview: [] as Track[],
  loading: false,
  error: false,
}))
vi.mock('./BatchTrackActions', () => ({ BatchTrackActions: (props: Parameters<typeof BatchTrackActions>[0]) => { h.batch = props; return null } }))
vi.mock('../../hooks/useLazyPlaylist', () => ({ useLazyPlaylist: (_playlist: Playlist, initialTracks?: Track[]) => ({
  total: initialTracks?.length || 100, tracks: initialTracks ?? h.preview, available: true, loading: h.loading, error: h.error,
  makeQueue: () => initialTracks ?? h.preview, ensureRange: vi.fn(), ensureAll: vi.fn(), refresh: vi.fn(), checkForUpdates: vi.fn(), retry: vi.fn(),
}) }))
vi.mock('../../lib/service-registry', () => ({ serviceFor: () => ({}) }))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ setQueue: vi.fn() }) } }))
vi.mock('../Explore/TrackRow', () => ({ TrackRow: () => null }))
vi.mock('../../lib/provider-account-session', () => ({ providerAccountSession: () => 'account' }))
vi.mock('../../providers/registry', () => ({ providerFor: () => ({ catalog: { getPlaylistSkeleton: h.skeleton } }) }))
vi.mock('../../stores/providers', () => ({
  isProviderParticipating: () => true,
  useProviderStore: (selector: (state: unknown) => unknown) => selector({ byId: { netease: { enabled: true, auth: 'authenticated' } } }),
}))
vi.mock('../../components/ui/VirtualList', () => ({ VirtualList: () => null }))

const tracks: Track[] = [1, 2].map(id => ({ provider: 'netease', source: 'netease', type: 'track', id, name: `歌曲${id}`, artist: '歌手', artists: [] }))
const playlist: Playlist = { provider: 'netease', source: 'netease', type: 'playlist', id: 'netease:daily-songs', name: '每日推荐', cover: '', creator: '', trackCount: 2, playCount: 0 }

describe('歌单详情整列表批量操作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.batch = undefined
    h.preview = []
    h.loading = false
    h.error = false
    h.skeleton.mockRejectedValue(new Error('合成 ID 不是平台歌单 ID'))
  })

  it('每日推荐使用已有完整歌曲追加或下载，不请求合成歌单 ID', async () => {
    renderToStaticMarkup(<PlaylistDetailView playlist={playlist} initialTracks={tracks} layoutIdPrefix="explore-cover" />)
    expect(h.batch?.tracks).toEqual(tracks)
    expect(h.batch?.collections ?? []).toEqual([])
    await expect(resolveBatchTracks(h.batch!.tracks, h.batch!.collections ?? [], new AbortController().signal)).resolves.toEqual(tracks)
    expect(h.skeleton).not.toHaveBeenCalled()
  })

  it('真实歌单只有首屏详情时仍展开整份歌单，不能截断为预览歌曲', async () => {
    h.preview = [tracks[0]]
    h.skeleton.mockResolvedValue({ tracks, trackIds: tracks.map(track => track.id) })
    renderToStaticMarkup(<PlaylistDetailView playlist={{ ...playlist, id: '123' }} layoutIdPrefix="explore-cover" />)
    expect(h.batch?.tracks).toEqual([])
    expect(h.batch?.collections?.[0].id).toBe('123')
    await expect(resolveBatchTracks(h.batch!.tracks, h.batch!.collections ?? [], new AbortController().signal)).resolves.toEqual(tracks)
    expect(h.skeleton).toHaveBeenCalledWith('123')
  })

  it.each(['loading', 'error'] as const)('%s 时不提供批量操作目标', state => {
    h[state] = true
    renderToStaticMarkup(<PlaylistDetailView playlist={playlist} initialTracks={tracks} layoutIdPrefix="explore-cover" />)
    expect(h.batch?.tracks).toEqual([])
    expect(h.batch?.collections ?? []).toEqual([])
  })
})
