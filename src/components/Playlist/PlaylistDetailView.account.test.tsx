import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Playlist, Track } from '../../types/domain'

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], account: 0,
  queue: [] as Track[], refresh: vi.fn(), metadata: vi.fn(), setQueue: vi.fn(), close: vi.fn(), check: vi.fn(), inspect: vi.fn(), toast: vi.fn(), writable: false, managementRevision: 0 }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.cursor++
    if (!(index in h.slots)) h.slots[index] = typeof initial === 'function' ? initial() : initial
    return [h.slots[index], (next: unknown) => { h.slots[index] = typeof next === 'function' ? next(h.slots[index]) : next }]
  },
  useRef: (initial: unknown) => h.slots[h.cursor++] ??= { current: initial },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = h.cursor++
    const previous = h.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) h.effects.push(() => {
      previous?.cleanup?.()
      h.slots[index] = { deps, cleanup: effect() }
    })
  },
}))
vi.mock('../../stores/platform-playlists', () => ({ usePlatformPlaylistsStore: (select: (state: unknown) => unknown) => select({ revision: { netease: h.managementRevision, qq: 0 } }) }))
vi.mock('../../lib/platform-playlists', () => ({ supportsPlatformPlaylists: () => h.writable, inspectPlatformPlaylist: h.inspect, mutatePlatformPlaylist: vi.fn(), platformPlaylistResultMessage: () => '' }))
vi.mock('./BatchTrackActions', () => ({ BatchTrackActions: () => null }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))
vi.mock('../Explore/TrackRow', () => ({ TrackRow: () => null }))
vi.mock('../../hooks/useLazyPlaylist', () => ({ useLazyPlaylist: () => ({ total: 1, tracks: h.queue,
  available: true, loading: false, error: false, makeQueue: () => h.queue, refresh: h.refresh, checkForUpdates: h.check, ensureRange: vi.fn(), ensureAll: async () => {}, retry: vi.fn(),
}) }))
vi.mock('../../lib/provider-account-session', () => ({ providerAccountSession: () => h.account }))
vi.mock('../../stores/providers', () => ({ useProviderStore: (select: (state: unknown) => unknown) => select({ byId: { netease: { enabled: true, auth: 'authenticated' } } }) }))
vi.mock('../../stores/navigation', () => ({ useNavigationStore: Object.assign(() => false, { getState: () => ({ goBack: vi.fn() }) }) }))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ setQueue: h.setQueue }) } }))
vi.mock('../../hooks/useMultiSelection', () => ({ useMultiSelection: () => ({ selected: new Set(), rootRef: { current: null }, surfaceProps: {} }) }))
vi.mock('../../lib/service-registry', () => { const service = { getAlbumDetail: h.metadata }; return { serviceFor: () => service } })
vi.mock('react-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-dom')>(), createPortal: (children: ReactNode) => children }))
import { PlaylistDetailView } from './PlaylistDetailView'
import { PlaylistPreviewModal } from '../Explore/PlaylistPreviewModal'

const playlist: Playlist = { source: 'netease', provider: 'netease', type: 'playlist', id: 'same', name: '选定集合', cover: '', creator: '', playCount: 0, trackCount: 1 }
interface NodeProps { children?: ReactNode; onClick?(): void; onPlay?(): void; renderRow?(index: number): ReactElement<NodeProps> }
function walk(node: ReactNode): ReactElement<NodeProps>[] {
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as ReactElement<NodeProps>
  return [element, ...[element.props.children].flat(Infinity).flatMap(child => walk(child as ReactNode))]
}
function text(node: ReactNode): string { return walk(node).map(element => typeof element.props.children === 'string' ? element.props.children : '').join(' ') }
function render(type: Playlist['type'] = 'playlist') {
  h.cursor = 0
  const tree = PlaylistDetailView({ playlist: { ...playlist, type }, layoutIdPrefix: 'test' })
  h.effects.splice(0).forEach(effect => effect())
  return tree
}
type MenuItem = { label: string; onSelect(): void }
// 刷新/改名收进标题旁「更多操作」菜单，读取传给 BatchTrackActions 的追加项。
function menu(tree: ReactNode): MenuItem[] { return (walk(tree).find(element => 'extraItems' in element.props)?.props as { extraItems?: MenuItem[] } | undefined)?.extraItems ?? [] }
function menuText(tree: ReactNode): string { return menu(tree).map(item => item.label).join(' ') }
function refresh(tree: ReactNode) { menu(tree).find(item => item.label.includes('刷新'))!.onSelect() }
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
beforeEach(() => {
  playlist.id = 'same'
  h.slots = []; h.effects = []; h.account++; h.writable = false; h.managementRevision = 0; h.inspect.mockReset()
  vi.clearAllMocks()
  h.refresh.mockReset().mockResolvedValue(undefined); h.check.mockResolvedValue(undefined); h.metadata.mockReset().mockResolvedValue(null)
  h.queue = [{ id: 'one', source: 'netease', provider: 'netease', type: 'song', name: '歌曲', artist: '', artists: [] }]
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { body: {} })
})
afterEach(() => {
  for (const slot of h.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.()
  vi.unstubAllGlobals()
})
it('旧刷新失败不污染新账号，新账号的刷新不被旧锁阻挡或解锁', async () => {
  let rejectOld!: (error: Error) => void
  let resolveCurrent!: () => void
  h.refresh.mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject }))
    .mockReturnValueOnce(new Promise<void>(resolve => { resolveCurrent = resolve }))
  refresh(render())
  h.account++
  render()
  refresh(render())
  expect(h.refresh).toHaveBeenCalledTimes(2)
  rejectOld(new Error('旧账号失败'))
  await settle()
  expect(menuText(render())).toContain('刷新中…')
  expect(h.toast).not.toHaveBeenCalled()
  resolveCurrent()
  await settle()
  expect(menuText(render())).toContain('刷新歌单')
})
it('同一专辑换号后重新读取资料，旧账号迟到资料不覆盖新标题', async () => {
  let resolveOld!: (detail: Playlist) => void
  h.metadata.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
    .mockResolvedValueOnce({ ...playlist, type: 'album', name: '当前专辑标题' })
  render('album')
  h.account++
  render('album')
  await settle()
  expect(text(render('album'))).toContain('当前专辑标题')
  resolveOld({ ...playlist, type: 'album', name: '旧专辑标题' })
  await settle()
  expect(text(render('album'))).not.toContain('旧专辑标题')
  expect(h.metadata).toHaveBeenCalledTimes(2)
})
it('详情旧行回调得到空队列时不覆盖现有播放队列', () => {
  const list = walk(render()).find(element => element.props.renderRow)!
  const row = list.props.renderRow!(0)
  h.queue = []
  row.props.onPlay!()
  expect(h.setQueue).not.toHaveBeenCalled()
})
it('预览旧播放全部和逐曲回调得到空队列时不清队列或关闭预览', () => {
  const modal = PlaylistPreviewModal({ playlist, onClose: h.close })
  const panel = walk(modal).find(element => typeof element.type === 'function' && element.type.name === 'PreviewPanel')!
  const tree = (panel.type as (props: { playlist: Playlist; onClose(): void }) => ReactElement)({ playlist, onClose: h.close })
  const buttons = walk(tree).filter(element => element.type === 'button' && (text(element).includes('播放全部') || text(element).includes('歌曲')))
  expect(buttons).toHaveLength(2)
  h.queue = []
  buttons.forEach(button => button.props.onClick!())
  expect(h.setQueue).not.toHaveBeenCalled()
  expect(h.close).not.toHaveBeenCalled()
})

it('服务端确认本人歌单后才显示改名，旧账号迟到的权限不能授予新账号', async () => {
  h.writable = true
  // 使用真实平台 ID 才探测编辑权，合成推荐集合永远不进入写流程。
  playlist.id = '900'
  let resolveOld!: (value: unknown) => void
  h.inspect.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
    .mockResolvedValueOnce({ playlistId: '900', name: '当前账号歌单' })
  expect(menuText(render())).not.toContain('重命名歌单')
  h.account++
  render()
  await settle()
  expect(text(render())).toContain('当前账号歌单')
  expect(menuText(render())).toContain('重命名歌单')
  resolveOld({ playlistId: '900', name: '旧账号歌单' })
  await settle()
  expect(text(render())).not.toContain('旧账号歌单')
  playlist.id = 'same'
})
it('归属核验被拒绝时不提供平台改名，不影响歌单播放展示', async () => {
  h.writable = true; playlist.id = '901'
  h.inspect.mockRejectedValue(new Error('只能管理本人歌单'))
  render(); await settle()
  expect(menuText(render())).not.toContain('重命名歌单')
  expect(text(render())).toContain('选定集合')
  playlist.id = 'same'
})

it('平台写入发生在手动刷新期间时，旧刷新结束后补读新的平台内容', async () => {
  let resolveOld!: () => void
  h.refresh.mockReturnValueOnce(new Promise<void>(resolve => { resolveOld = resolve }))
  refresh(render())
  expect(h.refresh).toHaveBeenCalledTimes(1)
  h.managementRevision++
  render()
  expect(h.refresh).toHaveBeenCalledTimes(1)
  resolveOld()
  await settle()
  render()
  expect(h.refresh).toHaveBeenCalledTimes(2)
})
