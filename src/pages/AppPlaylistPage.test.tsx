import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppPlaylistPage } from './AppPlaylistPage'
import type { Track } from '../types/domain'
import type { OfflineCacheStatus } from '../lib/offline-cache'

const h = vi.hoisted(() => ({
  index: 0, states: [] as unknown[], effects: [] as Array<() => (() => void) | void>, cleanups: [] as Array<() => void>,
  fetch: vi.fn(), tracks: [] as Track[], offline: { revision: 0, byKey: {} as Record<string, OfflineCacheStatus> },
  mode: 'browse', add: vi.fn(), remove: vi.fn(), restore: vi.fn(), clear: vi.fn(), toast: vi.fn(), undoToast: vi.fn(), row: null as ReactNode,
  batch: null as null | { tracks: Track[]; onAddToQueue?: (signal: AbortSignal) => number | Promise<number>; onRemove?: () => Promise<void> },
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.index++
    if (!(index in h.states)) h.states[index] = initial === 'browse' ? h.mode : typeof initial === 'function' ? initial() : initial
    return [h.states[index], (value: unknown) => { h.states[index] = value }]
  },
  useEffect: (effect: () => (() => void) | void) => { h.effects.push(effect) },
  useMemo: (factory: () => unknown) => factory(), useRef: () => ({ current: null }),
}))
vi.mock('../stores/app-playlists', async importOriginal => ({
  ...await importOriginal<typeof import('../stores/app-playlists')>(),
  useAppPlaylistsStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ items: [{ id: 'app', name: '应用歌单', tracks: h.tracks }], error: '' }),
    { getState: () => ({ removeTracks: h.remove, restoreTracks: h.restore }) },
  ),
}))
vi.mock('../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) }, useActionToastStore: { getState: () => ({ show: h.undoToast }) } }))
const providers = { netease: { enabled: false, auth: 'anonymous' }, qq: { enabled: false, auth: 'anonymous' }, apple: { enabled: false, auth: 'anonymous' } }
vi.mock('../stores/providers', () => ({ useProviderStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector({ byId: providers }), { getState: () => ({ byId: providers }), subscribe: () => () => {} },
) }))
vi.mock('../stores/offline-cache', () => ({ useOfflineCacheStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector(h.offline), { getState: () => h.offline },
) }))
vi.mock('../lib/offline-cache', () => ({ fetchOfflineStatuses: h.fetch }))
vi.mock('../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ addManyToQueue: h.add }) } }))
vi.mock('../stores/navigation', () => ({ useNavigationStore: { getState: () => ({}) } }))
vi.mock('../hooks/useMultiSelection', () => ({ useMultiSelection: () => ({
  selected: new Set(h.tracks.map(track => `${track.source}:${String(track.id)}`)), rootRef: { current: null },
  surfaceProps: {}, clear: h.clear, selectAll: vi.fn(), exit: vi.fn(), marquee: null,
}) }))
vi.mock('../components/Playlist/BatchTrackActions', () => ({ BatchTrackActions: (props: NonNullable<typeof h.batch>) => { h.batch = props; return null } }))
vi.mock('../lib/local-music-service', () => ({ localMusicService: {
  getAvailableTracks: async () => h.tracks.filter(track => track.source === 'local'),
} }))
vi.mock('../components/Explore/TrackRow', () => ({ TrackRow: () => null }))
vi.mock('../components/ui/ScrollArea', () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('../components/ui/VirtualList', () => ({ VirtualList: ({ renderRow }: { renderRow(index: number): ReactNode }) => { h.row = renderRow(0); return h.row } }))

function render() { h.index = 0; return renderToStaticMarkup(<AppPlaylistPage id="app" />) }
function buttons(node: ReactNode): Array<ReactElement<{ children?: ReactNode; 'aria-label'?: string; onClick(): void }>> {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; onClick(): void }>(child)) return []
    return child.type === 'button' ? [child] : buttons(child.props.children)
  })
}

describe('应用歌单完整离线状态快照', () => {
  beforeEach(() => {
    vi.clearAllMocks(); h.states = []; h.effects = []; h.offline = { revision: 0, byKey: {} }
    h.mode = 'browse'; h.batch = null; h.row = null; h.add.mockResolvedValue(1); h.remove.mockReturnValue([])
    h.tracks = [{ source: 'qq', provider: 'qq', type: 'song', id: '1', name: '歌曲', artist: '', artists: [] }]
  })
  afterEach(() => { h.cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals() })

  it('批量移出保存失败时保留选区，不报告成功并显示失败原因', async () => {
    h.mode = 'select'
    h.remove.mockImplementationOnce(() => { throw new Error('应用歌单保存失败') })
    render()
    vi.stubGlobal('window', { confirm: () => true })
    await h.batch!.onRemove!()
    expect(h.clear).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    expect(render()).toContain('应用歌单保存失败')
  })

  it('单曲移出成功提供撤销，按原歌单和移出回执恢复', () => {
    const removed = [{ track: h.tracks[0], index: 0 }]
    h.remove.mockReturnValueOnce(removed)
    render()
    buttons(h.row).find(button => button.props['aria-label'] === '移出歌单：歌曲')!.props.onClick()
    expect(h.remove).toHaveBeenCalledWith('app', ['qq:1'])
    expect(h.undoToast).toHaveBeenCalledWith('已移出「歌曲」', '撤销', expect.any(Function))
    h.undoToast.mock.calls[0][2]()
    expect(h.restore).toHaveBeenCalledWith('app', removed)
  })

  it('单曲移出失败不能提供撤销或成功回执', () => {
    h.remove.mockImplementationOnce(() => { throw new Error('保存失败') })
    render()
    buttons(h.row).find(button => button.props['aria-label'] === '移出歌单：歌曲')!.props.onClick()
    expect(h.undoToast).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
    expect(render()).toContain('保存失败')
  })
  it('聚合歌单保留播放与整理操作，不展示旧云端同步入口', () => {
    const html = render()
    expect(html).toContain('播放全部')
    expect(html).toContain('添加到播放队列')
    expect(html).toContain('管理应用歌单')
    expect(html).not.toContain('云端同步')
    expect(html).not.toContain('推送')
    expect(html).not.toContain('拉取')
  })
  it('四源混合收藏在平台全部停用时仍展示所有来源，不把收藏数当作可播放数', () => {
    h.tracks = (['netease', 'qq', 'apple', 'local'] as const).map(source => ({ source, provider: source, type: 'song', id: '1', name: '同 ID 曲目', artist: '', artists: [] }))
    const html = render()
    for (const label of ['网易云', 'QQ音乐', 'Apple Music', '本地']) expect(html).toContain(label)
    expect(html).toContain('4 首歌曲')
    expect(html).toContain('当前可播放 0 首')
  })
  it('来源可筛选、不可播放单独成组，顺序调整收进菜单而非每行常驻', () => {
    h.tracks = (['netease', 'qq'] as const).map(source => ({ source, provider: source, type: 'song', id: '1', name: '歌曲', artist: '', artists: [] }))
    const html = render()
    expect(html).toContain('按来源筛选')
    expect(html).toContain('2 首不可播放')
    expect(html).toContain('调整顺序')
    expect(html).toContain('多选歌曲')
    expect(html).toContain('搜索歌单内的歌曲或歌手')
    expect(html).not.toContain('上移')
  })

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

  it('多选入队保留平台停用后的缓存与本地歌曲，过滤不可用曲目', async () => {
    h.mode = 'select'
    h.tracks.push(
      { source: 'local', provider: 'local', type: 'song', id: '2', name: '本地歌曲', artist: '', artists: [] },
      { source: 'apple', provider: 'apple', type: 'song', id: '3', name: '未登录歌曲', artist: '', artists: [] },
    )
    h.fetch.mockResolvedValue([{ source: 'qq', id: '1', state: 'pinned', entryId: 'file' }])
    render()
    h.effects.splice(0).forEach(effect => { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup) })
    await Promise.resolve()
    render()
    expect(h.batch?.onAddToQueue).toBeTypeOf('function')
    await h.batch!.onAddToQueue!(new AbortController().signal)
    expect(h.add).toHaveBeenCalledWith([
      expect.objectContaining({ source: 'qq', id: '1' }),
      expect.objectContaining({ source: 'local', id: '2' }),
    ], true)
    h.offline.revision++
    await h.batch!.onAddToQueue!(new AbortController().signal)
    expect(h.add).toHaveBeenLastCalledWith([expect.objectContaining({ source: 'local', id: '2' })], true)
  })
})
