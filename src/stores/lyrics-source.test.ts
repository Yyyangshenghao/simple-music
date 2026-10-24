import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LYRICS_SOURCE_STORAGE_KEY, loadLyricsSourcePreferences, normalizeLyricsSourceOrder, rememberLyricsSource, useLyricsSourceStore } from './lyrics-source'
import { useToastStore } from './toast'

let archive: Map<string, string>
beforeEach(() => {
  archive = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => archive.get(key) ?? null, setItem: (key: string, value: string) => { archive.set(key, value) } })
  useLyricsSourceStore.setState({ defaultSource: 'auto', sourceOrder: null, health: {}, probes: {}, remembered: {} })
})
afterEach(() => { useToastStore.getState().dismiss(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('歌词来源偏好存档', () => {
  it('丢弃未知来源与非法键，匹配引用只保留录音字段', () => {
    archive.set(LYRICS_SOURCE_STORAGE_KEY, JSON.stringify({ schema: 1, defaultSource: 'unsafe', remembered: {
      'netease:1': { origin: 'qq', name: '歌曲', artist: '歌手', match: { source: 'qq', id: 2, name: '歌曲', artist: '歌手', artists: [], duration: 180000, mid: 'qq-mid', url: 'secret', cookie: 'secret-cookie' } },
      'unsafe:3': { origin: 'qq', name: '歌曲', artist: '歌手' },
      'apple:4': { origin: 'unsafe', name: '歌曲', artist: '歌手' },
    } }))
    loadLyricsSourcePreferences()
    expect(useLyricsSourceStore.getState().defaultSource).toBe('auto')
    expect(Object.keys(useLyricsSourceStore.getState().remembered)).toEqual(['netease:1'])
    expect(useLyricsSourceStore.getState().remembered['netease:1'].match).toEqual({ source: 'qq', provider: 'qq', type: 'song', id: '2', name: '歌曲', artist: '歌手', artists: [], duration: 180000, mid: 'qq-mid' })
  })
  it('保存失败保留原有偏好，明确反馈而不假装持久化成功', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    useLyricsSourceStore.getState().setDefaultSource('qq')
    expect(useLyricsSourceStore.getState().defaultSource).toBe('auto')
    expect(useToastStore.getState().message).toContain('无法保存')
    expect(rememberLyricsSource('netease:1', { origin: 'qq', name: '歌曲', artist: '歌手' })).toBe(false)
    expect(useLyricsSourceStore.getState().remembered).toEqual({})
  })
  it('记忆达到明确上限不静默淘汰已有选择', () => {
    const remembered = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`netease:${index}`, { origin: 'qq' as const, name: '歌曲', artist: '歌手' }]))
    useLyricsSourceStore.setState({ remembered })
    expect(rememberLyricsSource('netease:extra', { origin: 'qq', name: '新歌', artist: '歌手' })).toBe(false)
    expect(Object.keys(useLyricsSourceStore.getState().remembered)).toHaveLength(1000)
    expect(rememberLyricsSource('netease:1', { origin: 'netease', name: '歌曲', artist: '歌手' })).toBe(true)
    expect(useLyricsSourceStore.getState().remembered['netease:1'].origin).toBe('netease')
  })
})


describe('歌词来源完整顺序存档', () => {
  it('旧版首选迁移到第一位，其余来源补齐且去掉重复未知项', () => {
    archive.set(LYRICS_SOURCE_STORAGE_KEY, JSON.stringify({ schema: 1, defaultSource: 'kugou', remembered: {} }))
    loadLyricsSourcePreferences()
    expect(useLyricsSourceStore.getState().sourceOrder).toEqual(['kugou', 'netease', 'qq', 'amll'])
    expect(normalizeLyricsSourceOrder(['qq', 'qq', 'unknown', 'amll'])).toEqual(['qq', 'amll', 'netease', 'kugou'])
  })

  it('以新版顺序存档，不持久化本次运行故障与测试结果', () => {
    useLyricsSourceStore.setState({ health: { qq: { failures: 3, suspended: true } }, probes: { qq: { status: 'error', sample: '晴天', message: '连接失败' } } })
    const order = ['kugou', 'amll', 'qq', 'netease'] as const
    useLyricsSourceStore.getState().setSourceOrder([...order])
    expect(JSON.parse(archive.get(LYRICS_SOURCE_STORAGE_KEY)!)).toEqual({ schema: 2, defaultSource: 'auto', sourceOrder: order, remembered: {} })
    useLyricsSourceStore.setState({ sourceOrder: null, health: {}, probes: {} })
    loadLyricsSourcePreferences()
    expect(useLyricsSourceStore.getState()).toMatchObject({ sourceOrder: order, health: {}, probes: {} })
  })

  it('拒绝不完整或重复顺序，保存失败不改变已发布偏好', () => {
    const store = useLyricsSourceStore.getState()
    expect(() => store.setSourceOrder(['qq', 'qq', 'amll', 'kugou'])).toThrow('无效')
    expect(() => store.setSourceOrder(['qq'])).toThrow('无效')
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    store.setSourceOrder(['qq', 'netease', 'amll', 'kugou'])
    expect(useLyricsSourceStore.getState().sourceOrder).toBeNull()
    expect(useToastStore.getState().message).toContain('无法保存')
  })

  it('忘记单首仅删除对应记录，保存失败时保留记录', () => {
    rememberLyricsSource('netease:1', { origin: 'qq', name: '歌曲', artist: '歌手' })
    rememberLyricsSource('netease:2', { origin: 'amll', name: '另一首', artist: '歌手' })
    useLyricsSourceStore.getState().forgetTrack('netease:1')
    expect(Object.keys(useLyricsSourceStore.getState().remembered)).toEqual(['netease:2'])
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    useLyricsSourceStore.getState().forgetTrack('netease:2')
    expect(useLyricsSourceStore.getState().remembered['netease:2'].origin).toBe('amll')
  })
})
