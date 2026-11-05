import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { SongCommentsPage as CommentPage } from '../types/song-comments'
import { useProviderStore } from '../stores/providers'
import { providerAccountSession, advanceProviderAccountSession } from '../lib/provider-account-session'
import { SongCommentsPage } from './SongCommentsPage'

const h = vi.hoisted(() => ({ result: null as unknown }))
vi.mock('react', async original => {
  const module = await original<typeof import('react')>()
  return { ...module, useState: (initial: unknown) => initial === null ? [h.result, vi.fn()] : module.useState(initial) }
})
vi.mock('../stores/providers', async original => {
  const module = await original<typeof import('../stores/providers')>()
  return { ...module, useProviderStore: Object.assign((selector: (state: ReturnType<typeof module.useProviderStore.getState>) => unknown) => selector(module.useProviderStore.getState()), module.useProviderStore) }
})

const initial = useProviderStore.getState()
const track: Track = { source: 'netease', provider: 'netease', type: 'song', id: 1, name: '歌曲', artist: '歌手', artists: [] }
beforeEach(() => {
  h.result = null
  useProviderStore.setState({ byId: { ...initial.byId, netease: { enabled: true, auth: 'authenticated' } } })
})
afterEach(() => useProviderStore.setState(initial))

function seed(page: CommentPage) {
  h.result = { page, track, account: providerAccountSession('netease'), runtime: useProviderStore.getState().byId.netease }
}

describe('歌曲评论页', () => {
  it('按纯文本显示热评与最新评论，保留换行且不执行正文HTML', () => {
    const comment = { id: 'hot', content: '<img src=x onerror=alert(1)>\n第二行', likedCount: 2, time: 1700000000000, user: { id: 1, nickname: '听众', avatar: '' } }
    seed({ comments: [{ ...comment, id: 'new', content: '最新评论正文' }], hotComments: [comment], total: 30, nextOffset: 20 })
    const html = renderToStaticMarkup(<SongCommentsPage track={track} />)
    expect(html).toContain('热评')
    expect(html).toContain('最新评论 · 30')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;\n第二行')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('加载更多评论')
  })

  it('坏时间和超出Date范围的时间不影响正文显示', () => {
    seed({ comments: [NaN, Infinity, 1e30].map((time, id) => ({ id, content: `正文${id}`, likedCount: 0, time, user: null })), hotComments: [], total: 3 })
    const html = renderToStaticMarkup(<SongCommentsPage track={track} />)
    expect(html).toContain('正文0')
    expect(html).toContain('正文1')
    expect(html).toContain('正文2')
    expect(html).not.toContain('<time')
  })

  it('旧曲目缺少标题和歌手时显示占位，避免孤立分隔符', () => {
    const html = renderToStaticMarkup(<SongCommentsPage track={{ ...track, name: '', artist: '', pending: true }} />)
    expect(html).toContain('待加载歌曲')
    expect(html).not.toContain(' · </span>')
  })

  it('换号首帧隐藏旧评论，来源停用和不支持来源显示真实边界', () => {
    seed({ comments: [{ id: 1, content: '旧账号评论', likedCount: 0, time: 0, user: null }], hotComments: [], total: 1 })
    advanceProviderAccountSession('netease')
    expect(renderToStaticMarkup(<SongCommentsPage track={track} />)).not.toContain('旧账号评论')
    useProviderStore.setState(state => ({ byId: { ...state.byId, netease: { enabled: false, auth: 'authenticated' } } }))
    expect(renderToStaticMarkup(<SongCommentsPage track={track} />)).toContain('请登录并启用歌曲所属平台')
    expect(renderToStaticMarkup(<SongCommentsPage track={{ ...track, source: 'local' }} />)).toContain('这个来源暂不提供歌曲评论')
  })
})
