import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearProviderRequestCache, requestProviderData } from '../../lib/provider-request-cache'
import { advanceProviderAccountSession, providerAccountSession } from '../../lib/provider-account-session'
import type { Track } from '../../types/domain'

const h = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  setters: [] as ReturnType<typeof vi.fn>[],
  state: { byId: { netease: { enabled: true, auth: 'authenticated' } } },
  get: vi.fn(), queue: vi.fn(),
}))

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect) },
  useState: (value: unknown) => {
    const setter = vi.fn()
    h.setters.push(setter)
    return [typeof value === 'function' ? value() : value, setter]
  },
}))
vi.mock('../../lib/api', () => ({ api: { get: h.get } }))
vi.mock('../../stores/providers', () => ({ useProviderStore: Object.assign(
  (select: (state: typeof h.state) => unknown) => select(h.state), { getState: () => h.state }
) }))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ setQueue: h.queue }) } }))
vi.mock('../ui/ActionButton', () => ({ ActionButton: ({ label }: { label: string }) => <button>{label}</button> }))
vi.mock('./TrackRow', () => ({ TrackRow: ({ track }: { track: Track }) => <span>{track.name}</span> }))

import { FeaturedSongs } from './FeaturedSongs'
import { TrackRow } from './TrackRow'

const song = (id: number): Track => ({ id, provider: 'netease', source: 'netease', type: 'song', name: `歌曲${id}`, artist: '歌手', artists: [] })
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

function findRows(node: ReactNode): ReactElement<{ onPlay(): void }>[] {
  if (Array.isArray(node)) return node.flatMap(findRows)
  if (!isValidElement(node)) return []
  const element = node as ReactElement<{ children?: ReactNode; onPlay(): void }>
  return [...(element.type === TrackRow ? [element] : []), ...findRows(element.props.children)]
}

beforeEach(() => {
  clearProviderRequestCache()
  vi.clearAllMocks()
  h.effects = []
  h.setters = []
  h.state.byId.netease = { enabled: true, auth: 'authenticated' }
})

describe('网易歌曲精选', () => {
  it('复用缓存并去重歌曲，单曲播放使用同一完整集合', async () => {
    const tracks = [song(1), song(2)]
    await requestProviderData('netease', `discovery:featured-songs:${providerAccountSession('netease')}`,
      async () => ({ banners: [{ track: tracks[0] }, { track: tracks[0] }, { track: tracks[1] }] }))
    const element = FeaturedSongs()
    const rows = findRows(element)
    expect(rows).toHaveLength(2)
    rows[1].props.onPlay()
    expect(h.queue).toHaveBeenCalledWith(tracks, 1)
    expect(renderToStaticMarkup(element)).toContain('歌曲精选')
  })

  it('无歌曲类推荐时不显示空栏目，缺详情则提供恢复入口', async () => {
    const scope = `discovery:featured-songs:${providerAccountSession('netease')}`
    await requestProviderData('netease', scope, async () => ({ banners: [] }))
    expect(FeaturedSongs()).toBeNull()
    await requestProviderData('netease', scope, async () => ({ banners: [], partial: true }), { force: true })
    expect(renderToStaticMarkup(<FeaturedSongs />)).toContain('歌曲精选暂时无法加载')
  })

  it('换号或关闭组件后，迟到响应不更新栏目', async () => {
    let resolve!: (value: { banners: { track: Track }[] }) => void
    h.get.mockImplementation(() => new Promise(done => { resolve = done }))
    FeaturedSongs()
    const close = h.effects[0]()
    h.setters[1].mockClear()
    if (typeof close === 'function') close()
    advanceProviderAccountSession('netease')
    resolve({ banners: [{ track: song(1) }] })
    await flush()
    expect(h.setters[1]).not.toHaveBeenCalled()
  })

  it('禁用来源后隐藏栏目且不再请求', () => {
    h.state.byId.netease.enabled = false
    expect(FeaturedSongs()).toBeNull()
    h.effects.forEach(effect => effect())
    expect(h.get).not.toHaveBeenCalled()
  })
})
