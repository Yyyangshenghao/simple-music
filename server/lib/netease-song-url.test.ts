import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ levels: {} as Record<string, string | null>, calls: [] as string[], failures: {} as Record<string, number> }))
vi.mock('NeteaseCloudMusicApi', () => ({
  default: {
    song_url_v1: async ({ level }: { level: string }) => {
      h.calls.push(level)
      if ((h.failures[level] ?? 0) > 0) {
        h.failures[level] -= 1
        throw { status: 400, body: { code: -460 } }
      }
      const actual = h.levels[level]
      return { body: { data: [actual ? { url: `https://m.music/${actual}`, level: actual, br: 1 } : { url: null }] } }
    },
  },
}))
import { handleSongQualities, handleSongUrl } from './netease-client'

const svip = { loggedIn: true, vipType: 11, vipLevel: 'svip', isSvip: true }

beforeEach(() => {
  h.calls = []
  h.failures = {}
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

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

describe('handleSongQualities 风控重试', () => {
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
