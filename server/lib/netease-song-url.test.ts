import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ levels: {} as Record<string, string | null>, calls: [] as string[], failures: {} as Record<string, number>, code: 500, resolvedCode: 0, legacy: vi.fn() }))
vi.mock('NeteaseCloudMusicApi', () => ({
  default: {
    song_url: h.legacy,
    song_url_v1: async ({ level }: { level: string }) => {
      h.calls.push(level)
      if ((h.failures[level] ?? 0) > 0) {
        h.failures[level] -= 1
        throw { status: 400, body: { code: h.code } }
      }
      if (h.resolvedCode) return { status: 200, body: { code: h.resolvedCode } }
      const actual = h.levels[level]
      return { body: { data: [actual ? { url: `https://m.music/${actual}`, level: actual, br: 1 } : { url: null }] } }
    },
  },
}))
import { handleSongQualities, handleSongUrl } from './netease-client'

const svip = { loggedIn: true, vipType: 11, vipLevel: 'svip', isSvip: true }
let now = Date.now()

beforeEach(() => {
  now += 60_001
  vi.spyOn(Date, 'now').mockReturnValue(now)
  h.calls = []
  h.levels = {}
  h.failures = {}
  h.code = 500
  h.resolvedCode = 0
  h.legacy.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('handleSongUrl 「最高」跳过音效变体', () => {
  it('无母带时上游降级的鲸云音效不收，改取高清臻音', async () => {
    h.levels = { jymaster: 'jyeffect', hires: 'hires', lossless: 'lossless' }
    const result = await handleSongUrl('1', svip, 'max', 'c')
    expect(result.level).toBe('hires')
    expect(h.calls).toEqual(['jymaster', 'hires'])
  })

  it('有母带直接取母带', async () => {
    h.levels = { jymaster: 'jymaster' }
    expect((await handleSongUrl('1', svip, 'max', 'c')).level).toBe('jymaster')
  })

  it('没有臻音时取无损', async () => {
    h.levels = { jymaster: 'jyeffect', hires: 'lossless', lossless: 'lossless' }
    expect((await handleSongUrl('1', svip, 'max', 'c')).level).toBe('lossless')
  })

  it('明确选择鲸云音效时照常返回', async () => {
    h.levels = { jyeffect: 'jyeffect' }
    expect((await handleSongUrl('1', svip, 'jyeffect', 'c')).level).toBe('jyeffect')
  })
})

describe('handleSongQualities 普通瞬时错误重试', () => {
  it('单档出错重试一次后成功，结果完整', async () => {
    h.levels = { hires: 'hires', lossless: 'lossless' }
    h.failures = { hires: 1 }
    const result = await handleSongQualities('1', { loggedIn: true }, 'c', 0)
    expect(result.incomplete).toBeUndefined()
    expect(result.qualities.map((q) => q.level)).toEqual(['hires', 'lossless'])
    expect(h.calls.filter((l) => l === 'hires')).toHaveLength(2)
  })

  it('重试仍失败标记 incomplete，继续探测其余档', async () => {
    h.levels = { hires: 'hires', lossless: 'lossless' }
    h.failures = { hires: 2 }
    const result = await handleSongQualities('1', { loggedIn: true }, 'c', 0)
    expect(result.incomplete).toBe(true)
    expect(result.qualities.map((q) => q.level)).toEqual(['lossless'])
  })
})

describe('网易取链风控止损', () => {
  it('普通取链错误仍可回退旧接口', async () => {
    h.failures = { hires: 1 }
    h.legacy.mockResolvedValue({ body: { data: [{ url: 'https://m.music/old', level: 'hires' }] } })
    expect((await handleSongUrl('1', { loggedIn: true }, 'max', 'c')).url).toBe('https://m.music/old')
    expect(h.legacy).toHaveBeenCalledTimes(1)
  })

  it('旧取链接口收到风控也停止后续档位', async () => {
    h.failures = { hires: 1 }
    h.legacy.mockRejectedValue({ status: 429, body: {} })
    await expect(handleSongUrl('1', { loggedIn: true }, 'max', 'c')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    expect(h.calls).toEqual(['hires'])
    expect(h.legacy).toHaveBeenCalledTimes(1)
  })

  it.each([-460, -462, 429])('收到 %s 后不切旧接口或逐档重试', async (code) => {
    h.code = code
    h.failures = { jymaster: 1 }
    await expect(handleSongUrl('1', svip, 'max', 'c')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    expect(h.calls).toEqual(['jymaster'])
    expect(h.legacy).not.toHaveBeenCalled()
  })

  it('音质探测遇到风控立即停止，保留已探测档并标为不完整', async () => {
    h.levels = { hires: 'hires' }
    h.code = -460
    h.failures = { lossless: 1 }
    expect(await handleSongQualities('1', { loggedIn: true }, 'c', 0)).toMatchObject({
      qualities: [{ level: 'hires' }], incomplete: true,
    })
    expect(h.calls).toEqual(['jyeffect', 'hires', 'lossless'])
  })

  it('冷却期间其他曲目、账号和档位探测不再请求取链上游，60 秒后允许恢复', async () => {
    h.code = -460
    h.failures = { hires: 1 }
    await expect(handleSongUrl('1', { loggedIn: true }, 'max', 'c')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    await expect(handleSongUrl('2', svip, 'max', 'other')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    expect(await handleSongQualities('2', svip, 'other', 0)).toEqual({ qualities: [], incomplete: true })
    expect(h.calls).toEqual(['hires'])
    vi.mocked(Date.now).mockReturnValue(now + 59_999)
    await expect(handleSongUrl('2', svip, 'max', 'other')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    vi.mocked(Date.now).mockReturnValue(now + 60_001)
    h.levels = { hires: 'hires' }
    expect((await handleSongUrl('1', { loggedIn: true }, 'max', 'c')).playable).toBe(true)
    expect(h.calls).toEqual(['hires', 'hires'])
  })

  it('正常返回的响应体携带风控码时也停止探测', async () => {
    h.resolvedCode = -460
    expect(await handleSongQualities('1', svip, 'c', 0)).toEqual({ qualities: [], incomplete: true })
    expect(h.calls).toEqual(['jymaster'])
  })
})
