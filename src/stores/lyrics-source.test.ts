import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LYRICS_SOURCE_STORAGE_KEY, loadLyricsSourcePreferences, rememberLyricsSource, useLyricsSourceStore } from './lyrics-source'
import { useToastStore } from './toast'

let archive: Map<string, string>
beforeEach(() => {
  archive = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => archive.get(key) ?? null, setItem: (key: string, value: string) => { archive.set(key, value) } })
  useLyricsSourceStore.setState({ defaultSource: 'auto', remembered: {} })
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
