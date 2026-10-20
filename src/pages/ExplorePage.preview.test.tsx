import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppView } from '../stores/navigation'
import type { Playlist } from '../types/domain'
import { ExplorePage } from './ExplorePage'

const h = vi.hoisted(() => ({
  view: 'explore' as AppView,
  present: true,
  preview: null as Playlist | null,
  effects: [] as Array<() => void>,
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => [h.preview, (value: Playlist | null) => { h.preview = value }],
  useEffect: (effect: () => void) => { h.effects.push(effect) },
  useLayoutEffect: () => {},
}))
vi.mock('motion/react', async importOriginal => ({
  ...await importOriginal<typeof import('motion/react')>(),
  useIsPresent: () => h.present,
}))
vi.mock('../stores/navigation', () => ({ useNavigationStore: (selector: (state: { currentView: AppView }) => unknown) => selector({ currentView: h.view }) }))
vi.mock('../hooks/useContentProvider', () => ({ useContentProvider: () => ({ sources: [], current: null }) }))
vi.mock('../components/Explore/ProviderRecommendationSection', () => ({ ProviderRecommendationSection: () => null }))
vi.mock('../components/Playlist/PlaylistDetailView', () => ({ PlaylistDetailView: () => null }))
vi.mock('../components/Explore/PlaylistPreviewModal', () => ({
  PlaylistPreviewModal: ({ playlist }: { playlist: Playlist | null }) => <div data-preview-open={Boolean(playlist)} />,
}))

const playlist: Playlist = { source: 'qq', provider: 'qq', type: 'playlist', id: 1, name: '预览', cover: '', creator: '', trackCount: 1, playCount: 0 }
const render = () => renderToStaticMarkup(<ExplorePage />)

beforeEach(() => {
  Object.assign(h, { view: 'explore', present: true, preview: playlist, effects: [] })
})
afterEach(() => { h.effects = [] })

describe('探索页预览的导航生命周期', () => {
  it('打开预览时正常显示，仍由原预览组件承接封面转场', () => {
    expect(render()).toContain('data-preview-open="true"')
  })

  it('前进到详情后来源页保留，但预览立即关闭且返回时不重现', () => {
    h.view = { type: 'playlist', from: 'explore', playlist }
    expect(render()).toContain('data-preview-open="false"')
    h.effects.splice(0).forEach(effect => effect())
    expect(h.preview).toBeNull()
    h.view = 'explore'
    expect(render()).toContain('data-preview-open="false"')
  })

  it('退出动画中的旧探索页不能因新探索页成为当前路由而重现预览', () => {
    h.present = false
    expect(render()).toContain('data-preview-open="false"')
    h.effects.splice(0).forEach(effect => effect())
    expect(h.preview).toBeNull()
  })
})
