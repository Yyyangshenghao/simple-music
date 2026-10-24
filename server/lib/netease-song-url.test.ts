import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ levels: {} as Record<string, string | null>, calls: [] as string[] }))
vi.mock('NeteaseCloudMusicApi', () => ({
  default: {
    song_url_v1: async ({ level }: { level: string }) => {
      h.calls.push(level)
      const actual = h.levels[level]
      return { body: { data: [actual ? { url: `https://m.music/${actual}`, level: actual, br: 1 } : { url: null }] } }
    },
  },
}))
import { handleSongUrl } from './netease-client'

const svip = { loggedIn: true, vipType: 11, vipLevel: 'svip', isSvip: true }

beforeEach(() => {
  h.calls = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
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
