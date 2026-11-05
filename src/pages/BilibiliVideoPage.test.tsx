import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import { useProviderStore } from '../stores/providers'
import { providerAccountSession } from '../lib/provider-account-session'
import { BilibiliVideoPage } from './BilibiliVideoPage'

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
const bvid = 'BV1GJ411x7h7'
const track: Track = { provider: 'bilibili', source: 'bilibili', type: 'song', id: bvid, bvid, name: '视频原题', videoTitle: '视频原题', artist: '投稿者', uploader: '投稿者', artists: [], videoPartCount: 3 }

beforeEach(() => {
  h.result = null
  useProviderStore.setState({ byId: { ...initial.byId, bilibili: { enabled: true, auth: 'anonymous' } } })
})
afterEach(() => useProviderStore.setState(initial))

describe('哔哩哔哩视频直达', () => {
  it('游客可查看视频，多集视频说明首 P，沿用歌曲加入入口', () => {
    h.result = { track, bvid, runtime: useProviderStore.getState().byId.bilibili, session: providerAccountSession('bilibili') }
    const html = renderToStaticMarkup(<BilibiliVideoPage input={bvid} />)
    expect(html).toContain('播放音频')
    expect(html).toContain('仅播放第 1P')
    expect(html).toContain('UP 主')
    expect(html).toContain('aria-label="加入歌单"')
    expect(html).not.toContain('请先启用')
  })

  it('启停变化首帧不保留旧视频，未启用时引导设置而非登录', () => {
    h.result = { track, bvid, runtime: useProviderStore.getState().byId.bilibili, session: providerAccountSession('bilibili') }
    useProviderStore.setState(state => ({ byId: { ...state.byId, bilibili: { enabled: false, auth: 'anonymous' } } }))
    const html = renderToStaticMarkup(<BilibiliVideoPage input={bvid} />)
    expect(html).toContain('请先启用哔哩哔哩音源')
    expect(html).toContain('打开音源设置')
    expect(html).not.toContain('视频原题')
    expect(html).not.toContain('登录')
  })

  it('短链接与分 P 输入显示原因，不出现播放入口', () => {
    const short = renderToStaticMarkup(<BilibiliVideoPage input="https://b23.tv/abc" />)
    expect(short).toContain('复制完整的视频链接')
    const multipart = renderToStaticMarkup(<BilibiliVideoPage input={`https://www.bilibili.com/video/${bvid}?p=2`} />)
    expect(multipart).toContain('暂不支持指定分 P')
    expect(multipart).not.toContain('播放音频')
  })
})
