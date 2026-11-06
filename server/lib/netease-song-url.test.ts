import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ levels: {} as Record<string, string | null>, calls: [] as string[], protocols: [] as Array<string | undefined>, failures: {} as Record<string, number>, code: 500, resolvedCode: 0, clientLimited: false, trial: false, legacy: vi.fn() }))
vi.mock('NeteaseCloudMusicApi', () => ({
  default: {
    song_url: h.legacy,
    song_url_v1: async ({ level, crypto }: { level: string; crypto?: string }) => {
      h.calls.push(level)
      h.protocols.push(crypto)
      if (h.clientLimited && crypto !== 'weapi') throw { status: 400, body: { code: -460 } }
      if ((h.failures[level] ?? 0) > 0) {
        h.failures[level] -= 1
        throw { status: 400, body: { code: h.code } }
      }
      if (h.resolvedCode) return { status: 200, body: { code: h.resolvedCode } }
      const actual = h.levels[level]
      return { body: { data: [actual ? { url: `https://m.music/${actual}`, level: actual, br: 1, freeTrialInfo: h.trial ? { start: 0, end: 30_000 } : null } : { url: null }] } }
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
  h.protocols = []
  h.levels = {}
  h.failures = {}
  h.code = 500
  h.resolvedCode = 0
  h.clientLimited = false
  h.trial = false
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
    expect(h.protocols).toEqual(['eapi'])
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
  it('客户端通道受限时仍可通过网页通道获取完整播放地址', async () => {
    h.clientLimited = true
    h.levels = { hires: 'exhigh' }
    await expect(handleSongUrl('1', { loggedIn: true }, 'max', 'c')).resolves.toMatchObject({
      url: 'https://m.music/exhigh', playable: true, trial: false, level: 'exhigh', quality: '极高',
    })
    expect(h.calls).toEqual(['hires', 'hires'])
    expect(h.protocols).toEqual(['eapi', 'weapi'])
    expect(h.legacy).not.toHaveBeenCalled()
    await expect(handleSongUrl('2', { loggedIn: true }, 'max', 'c')).resolves.toMatchObject({ playable: true, level: 'exhigh' })
    expect(h.protocols).toEqual(['eapi', 'weapi', 'weapi'])
    vi.mocked(Date.now).mockReturnValue(now + 60_001)
    h.clientLimited = false
    h.levels = { hires: 'hires' }
    await expect(handleSongUrl('3', { loggedIn: true }, 'max', 'c')).resolves.toMatchObject({ playable: true, level: 'hires' })
    expect(h.protocols.at(-1)).toBe('eapi')
  })

  it('音质探测也使用网页通道，客户端受限不清空实际可用档位', async () => {
    h.clientLimited = true
    h.levels = { hires: 'exhigh', standard: 'standard' }
    const result = await handleSongQualities('1', { loggedIn: true }, 'c', 0)
    expect(result.incomplete).toBeUndefined()
    expect(result.qualities.map(q => q.level)).toEqual(['exhigh', 'standard'])
  })

  it('网页通道只返回试听时保留试听标记，不当作完整音频', async () => {
    h.clientLimited = true
    h.trial = true
    h.levels = { standard: 'standard' }
    await expect(handleSongUrl('1', { loggedIn: true }, 'standard', 'c')).resolves.toMatchObject({
      url: 'https://m.music/standard', playable: true, trial: true,
      restriction: { category: 'trial_only' },
    })
    expect(h.protocols).toEqual(['eapi', 'weapi'])
  })

  it('普通取链错误仍可回退旧接口', async () => {
    h.failures = { hires: 1 }
    h.legacy.mockResolvedValue({ body: { data: [{ url: 'https://m.music/old', level: 'hires' }] } })
    expect((await handleSongUrl('1', { loggedIn: true }, 'max', 'c')).url).toBe('https://m.music/old')
    expect(h.legacy).toHaveBeenCalledTimes(1)
    expect(h.legacy).toHaveBeenCalledWith(expect.objectContaining({ crypto: 'eapi', cookie: 'c' }))
  })

  it('旧取链接口收到风控也停止后续档位', async () => {
    h.failures = { hires: 1 }
    h.legacy.mockRejectedValue({ status: 429, body: {} })
    await expect(handleSongUrl('1', { loggedIn: true }, 'max', 'c')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    expect(h.calls).toEqual(['hires'])
    expect(h.legacy).toHaveBeenCalledTimes(2)
    expect(h.legacy.mock.calls.map(([params]) => params.crypto)).toEqual(['eapi', 'weapi'])
  })

  it.each([-460, -462, 429])('两个通道均收到 %s 后不切旧接口或逐档重试', async (code) => {
    h.code = code
    h.failures = { jymaster: 2 }
    await expect(handleSongUrl('1', svip, 'max', 'c')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    expect(h.calls).toEqual(['jymaster', 'jymaster'])
    expect(h.legacy).not.toHaveBeenCalled()
  })

  it('音质探测遇到风控立即停止，保留已探测档并标为不完整', async () => {
    h.levels = { hires: 'hires' }
    h.code = -460
    h.failures = { lossless: 2 }
    expect(await handleSongQualities('1', { loggedIn: true }, 'c', 0)).toMatchObject({
      qualities: [{ level: 'hires' }], incomplete: true,
    })
    expect(h.calls).toEqual(['jyeffect', 'hires', 'lossless', 'lossless'])
  })

  it('两个通道均受限后共享各自冷却，60 秒后允许恢复', async () => {
    h.code = -460
    h.failures = { hires: 2 }
    await expect(handleSongUrl('1', { loggedIn: true }, 'max', 'c')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    await expect(handleSongUrl('2', svip, 'max', 'other')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    expect(await handleSongQualities('2', svip, 'other', 0)).toEqual({ qualities: [], incomplete: true })
    expect(h.calls).toEqual(['hires', 'hires'])
    vi.mocked(Date.now).mockReturnValue(now + 59_999)
    await expect(handleSongUrl('2', svip, 'max', 'other')).resolves.toMatchObject({ url: null, playable: false, reason: 'rate_limited', message: expect.stringContaining('网易云请求受限') })
    vi.mocked(Date.now).mockReturnValue(now + 60_001)
    h.levels = { hires: 'hires' }
    expect((await handleSongUrl('1', { loggedIn: true }, 'max', 'c')).playable).toBe(true)
    expect(h.calls).toEqual(['hires', 'hires', 'hires'])
  })

  it('正常返回的响应体携带风控码时也停止探测', async () => {
    h.resolvedCode = -460
    expect(await handleSongQualities('1', svip, 'c', 0)).toEqual({ qualities: [], incomplete: true })
    expect(h.calls).toEqual(['jymaster', 'jymaster'])
  })
})
