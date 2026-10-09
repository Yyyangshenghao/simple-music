import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaylistPreviewModal } from './PlaylistPreviewModal'
import type { Playlist, Track } from '../../types/domain'

const state = vi.hoisted(() => ({ total: 0, tracks: [] as (Track | null)[], loading: true, error: false }))
vi.mock('../../hooks/useLazyPlaylist', () => ({ useLazyPlaylist: () => ({ ...state, makeQueue: () => [] }) }))
vi.mock('react-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-dom')>(),
  createPortal: (children: React.ReactNode) => children,
}))

const playlist: Playlist = { provider: 'netease', source: 'netease', type: 'playlist', id: 'preview', name: '预览歌单', cover: '', trackCount: 2, playCount: 0, creator: '' }
const render = (entry: Playlist = playlist) => renderToStaticMarkup(<PlaylistPreviewModal playlist={entry} onClose={() => {}} />)

describe('歌单预览加载状态', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { body: {} })
    Object.assign(state, { total: 0, tracks: [], loading: true, error: false })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('加载时保留歌曲占位和明确的忙碌状态，不误报空歌单', () => {
    const html = render()
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="status" aria-label="正在加载歌曲"')
    expect(html).not.toContain('暂无可预览的歌曲')
  })

  it('加载成功后显示可播放曲目并移除加载占位', () => {
    Object.assign(state, { total: 1, loading: false, tracks: [{ id: 1, provider: 'netease', source: 'netease', type: 'track', name: '测试歌曲', artist: '歌手', artists: [] }] })
    const html = render()
    expect(html).toContain('aria-busy="false"')
    expect(html).toContain('测试歌曲')
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('暂无可预览的歌曲')
  })

  it.each([
    [false, '暂无可预览的歌曲'],
    [true, '歌曲暂时无法加载，请稍后重新打开'],
  ] as const)('加载结束后区分空列表与失败（error=%s）', (error, message) => {
    Object.assign(state, { loading: false, error })
    const html = render()
    expect(html).toContain(message)
    expect(html).not.toContain('role="status"')
  })

  it.each(['https://example.com/album.jpg', ''])('QQ 我喜欢预览的歌单封面和曲目补图均显示白心（cover=%s）', (cover) => {
    state.tracks = [{ id: 1, provider: 'qq', source: 'qq', type: 'track', name: '歌曲', artist: '歌手', artists: [], cover: 'https://example.com/album.jpg' }]
    const html = render({ ...playlist, provider: 'qq', source: 'qq', id: 'qq-liked:201', cover })
    expect(html).toContain('src="https://example.com/album.jpg"')
    expect(html).toContain('data-kind="liked-cover-overlay"')
  })

  it('普通 QQ 歌单预览保留原封面', () => {
    const html = render({ ...playlist, provider: 'qq', source: 'qq', name: '我喜欢的跑步歌单', cover: 'https://example.com/album.jpg' })
    expect(html).toContain('src="https://example.com/album.jpg"')
    expect(html).not.toContain('data-kind="liked-cover-overlay"')
  })
})
