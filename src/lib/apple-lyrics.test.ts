import { DOMParser } from '@xmldom/xmldom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { fetchNativeAppleLyrics } from './apple-lyrics'
import type { Track } from '../types/domain'
vi.mock('./api', () => ({ api: { get: vi.fn() } }))
const track: Track = { id: 'i.123', source: 'apple', provider: 'apple', type: 'song', name: '测试', artist: '歌手', artists: [], appleLibrary: true }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('DOMParser', DOMParser)
  vi.mocked(api.get).mockResolvedValue({ ttml: '<tt><body><p begin="1" end="3">歌词</p></body></tt>' })
})
afterEach(() => vi.unstubAllGlobals())
describe('原生歌词请求', () => {
  it('个人库优先采用已有曲库编号并返回 Apple 来源', async () => {
    expect((await fetchNativeAppleLyrics({ ...track, catalogId: '456' }))?.source).toBe('apple')
    expect(api.get).toHaveBeenCalledWith('/api/apple-music/lyrics', { id: '456', library: 'false' }, expect.anything())
  })
  it('缺少曲库编号时请求服务端解析个人库', async () => {
    await fetchNativeAppleLyrics(track)
    expect(api.get).toHaveBeenCalledWith('/api/apple-music/lyrics', { id: 'i.123', library: 'true' }, expect.anything())
  })
  it('保留原生 TTML 的翻译与音译', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ ttml: '<tt><body><p begin="1" end="3">愛<span xmlns:m="http://www.w3.org/ns/ttml#metadata" m:role="x-translation">爱</span><span xmlns:m="http://www.w3.org/ns/ttml#metadata" m:role="x-roman">ai</span></p></body></tt>' })
    const result = await fetchNativeAppleLyrics(track)
    expect(result?.aligned).toEqual([{ time: 1, text: '爱' }])
    expect(result?.roma).toEqual([{ time: 1, text: 'ai' }])
  })
  it('错误和取消均允许丢弃结果而不影响播放', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('unavailable'))
    expect(await fetchNativeAppleLyrics(track)).toBeNull()
    const controller = new AbortController()
    controller.abort()
    expect(await fetchNativeAppleLyrics(track, controller.signal)).toBeNull()
  })
})
