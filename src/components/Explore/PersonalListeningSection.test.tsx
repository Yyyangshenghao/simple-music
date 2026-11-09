import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearProviderRequestCache, requestProviderData } from '../../lib/provider-request-cache'
import { advanceProviderAccountSession, providerAccountSession } from '../../lib/provider-account-session'
import type { Track } from '../../types/domain'

const h = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  setters: [] as ReturnType<typeof vi.fn>[],
  providers: { byId: { netease: { enabled: true, auth: 'authenticated' }, qishui: { enabled: true, auth: 'authenticated' } } },
  recent: [] as { track: Track; playedAt: number }[],
  playlists: [] as { id: string; name: string; tracks: Track[] }[],
  playlistError: '',
  ranking: vi.fn(), queue: vi.fn(), navigate: vi.fn(), reload: vi.fn(),
}))

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect) },
  useState: (initial: unknown) => {
    const setter = vi.fn()
    h.setters.push(setter)
    return [typeof initial === 'function' ? initial() : initial, setter]
  },
}))
vi.mock('../../stores/providers', () => ({ useProviderStore: Object.assign(
  (selector: (state: typeof h.providers) => unknown) => selector(h.providers),
  { getState: () => h.providers }
) }))
vi.mock('../../stores/recent', () => ({ useRecentPlaysStore: (selector: (state: { items: typeof h.recent }) => unknown) => selector({ items: h.recent }) }))
vi.mock('../../stores/app-playlists', () => ({ useAppPlaylistsStore: Object.assign(
  (selector: (state: { items: typeof h.playlists; error: string }) => unknown) => selector({ items: h.playlists, error: h.playlistError }),
  { getState: () => ({ reload: h.reload }) }
) }))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ setQueue: h.queue }) } }))
vi.mock('../../stores/navigation', () => ({ useNavigationStore: { getState: () => ({ navigateTo: h.navigate }) } }))
vi.mock('../../providers/registry', () => ({ providerFor: () => ({ history: { getListeningRanking: h.ranking } }) }))
vi.mock('../ui/ActionButton', () => ({ ActionButton: ({ label, onClick }: { label: string; onClick(): void }) => <button onClick={onClick}>{label}</button> }))
vi.mock('../Playlist/AppPlaylistCover', () => ({ AppPlaylistCover: () => <span /> }))
vi.mock('./HorizontalCardRail', () => ({ HorizontalCardRail: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('./TrackRow', () => ({ TrackRow: ({ track, onPlay }: { track: Track; onPlay(): void }) => <button data-track={String(track.id)} onClick={onPlay}>{track.name}</button> }))

import { PersonalListeningSection } from './PersonalListeningSection'

const song = (id: number, source: Track['source'] = 'qishui'): Track => ({
  provider: source, source, type: 'song', id, name: `歌曲${id}`, artist: '歌手', artists: [],
})
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand)
  if (!isValidElement(node)) return node
  const element = node as ReactElement<{ children?: ReactNode }>
  if (typeof element.type === 'function') {
    const rendered = expand((element.type as (props: unknown) => ReactNode)(element.props))
    return isValidElement(rendered) ? cloneElement(rendered, { key: element.key }) : rendered
  }
  return Array.isArray(element.props.children)
    ? cloneElement(element, undefined, ...element.props.children.map(expand))
    : cloneElement(element, undefined, expand(element.props.children))
}

function buttons(node: ReactNode): ReactElement<{ children?: ReactNode; onClick(): void; 'data-track'?: string }>[] {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (!isValidElement(node)) return []
  const element = node as ReactElement<{ children?: ReactNode; onClick(): void }>
  return [...(element.type === 'button' ? [element] : []), ...buttons(element.props.children)]
}

beforeEach(() => {
  h.effects = []
  h.setters = []
  h.recent = []
  h.playlists = []
  h.playlistError = ''
  h.providers.byId.netease = { enabled: true, auth: 'authenticated' }
  h.providers.byId.qishui = { enabled: true, auth: 'authenticated' }
  vi.clearAllMocks()
  h.ranking.mockResolvedValue([])
})
afterEach(() => clearProviderRequestCache())

describe('探索个人收听内容', () => {
  it('汽水继续听只播放本机汽水记录，详情也携带相同队列', () => {
    h.recent = [song(1), song(2, 'qq'), song(3)].map(track => ({ track, playedAt: 0 }))
    const tree = expand(<PersonalListeningSection source="qishui" />)
    const actions = buttons(tree)
    actions.find(button => button.props['data-track'] === '3')!.props.onClick()
    expect(h.queue).toHaveBeenLastCalledWith([song(1), song(3)], 1)
    actions.find(button => button.props.children === '查看全部')!.props.onClick()
    expect(h.navigate).toHaveBeenCalledWith(expect.objectContaining({ type: 'playlist', tracks: [song(1), song(3)] }))
    expect(renderToStaticMarkup(tree)).toContain('本机最近播放')
    expect(renderToStaticMarkup(tree)).not.toContain('歌曲2')
  })

  it('含汽水的应用歌单保留混合歌曲总数并跳转完整歌单', () => {
    h.playlists = [
      { id: 'mixed', name: '我的混合歌单', tracks: [song(1), song(2, 'qq'), song(3)] },
      { id: 'qq-only', name: 'QQ歌单', tracks: [song(4, 'qq')] },
    ]
    const tree = expand(<PersonalListeningSection source="qishui" />)
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('3 首 · 含 2 首汽水音乐')
    expect(html).not.toContain('QQ歌单')
    buttons(tree).at(-1)!.props.onClick()
    expect(h.navigate).toHaveBeenCalledWith({ type: 'app-playlist', id: 'mixed' })
  })

  it('没有历史时保留搜索下一步，应用歌单读取失败可重试', () => {
    h.playlistError = '应用歌单读取失败，原存档已保留。请重试读取。'
    const tree = expand(<PersonalListeningSection source="qishui" />)
    expect(renderToStaticMarkup(tree)).toContain('通过顶栏搜索歌曲')
    buttons(tree).find(button => button.props.children === '重试读取')!.props.onClick()
    expect(h.reload).toHaveBeenCalledOnce()
  })

  it('周榜首页只预览六首，播放全部和详情保留完整周榜', async () => {
    const tracks = Array.from({ length: 8 }, (_, index) => song(index, 'netease'))
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
    await requestProviderData('netease', `history:weekly-tracks:${providerAccountSession('netease')}:${day}`, async () => tracks)
    const tree = expand(<PersonalListeningSection source="netease" />)
    const actions = buttons(tree)
    expect(actions.filter(button => button.props['data-track'] !== undefined)).toHaveLength(6)
    actions.find(button => button.props.children === '播放全部')!.props.onClick()
    expect(h.queue).toHaveBeenLastCalledWith(tracks, 0)
    actions.find(button => button.props.children === '查看全部')!.props.onClick()
    expect(h.navigate).toHaveBeenCalledWith(expect.objectContaining({ tracks, playlist: expect.objectContaining({ name: '本周常听', trackCount: 8 }) }))
  })

  it('账号切换或来源禁用后不发布迟到的周榜', async () => {
    let resolve!: (tracks: Track[]) => void
    h.ranking.mockImplementation(() => new Promise<Track[]>(done => { resolve = done }))
    expand(<PersonalListeningSection source="netease" />)
    h.effects[0]()
    h.setters[1].mockClear()
    advanceProviderAccountSession('netease')
    resolve([song(1, 'netease')])
    await flush()
    expect(h.setters[1]).not.toHaveBeenCalled()

    h.effects = []
    h.setters = []
    expand(<PersonalListeningSection source="netease" />)
    h.effects[0]()
    h.setters[1].mockClear()
    h.providers.byId.netease.enabled = false
    resolve([song(2, 'netease')])
    await flush()
    expect(h.setters[1]).not.toHaveBeenCalled()
  })

  it('来源关闭时不展示历史或发出周榜请求', () => {
    h.providers.byId.netease.enabled = false
    h.providers.byId.qishui.enabled = false
    h.recent = [{ track: song(1), playedAt: 0 }]
    expect(renderToStaticMarkup(<PersonalListeningSection source="qishui" />)).toBe('')
    expect(renderToStaticMarkup(<PersonalListeningSection source="netease" />)).toBe('')
    h.effects.forEach(effect => effect())
    expect(h.ranking).not.toHaveBeenCalled()
  })
})
