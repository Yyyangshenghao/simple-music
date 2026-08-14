import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleQQLyric, handleQQSongUrl, pickQQImageUrl, pickQQPlaylistCover } from './qq-client'

const LOGGED_IN_COOKIE = 'uin=12345; qm_keyst=some-key-value'

describe('pickQQImageUrl', () => {
  it('跳过相对查询串并使用后续有效封面', () => {
    expect(pickQQImageUrl('?n=1', '//y.gtimg.cn/music/photo_new/cover.jpg?n=1'))
      .toBe('https://y.gtimg.cn/music/photo_new/cover.jpg?n=1')
  })

  it('没有有效地址时返回空字符串', () => {
    expect(pickQQImageUrl('?n=1', '', undefined)).toBe('')
  })

  it('歌单自身缺图时使用首首有封面的歌曲', () => {
    expect(pickQQPlaylistCover(
      { logo: '?n=1' },
      [{ cover: '' }, { cover: 'https://y.qq.com/music/photo_new/first-valid.jpg' }]
    )).toBe('https://y.qq.com/music/photo_new/first-valid.jpg')
  })
})

describe('handleQQLyric identifiers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('不会把字母数字混合的 mid 抽取成错误 songID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ lyric: { data: { lyric: '[00:00.00]正确歌词' } } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await handleQQLyric(LOGGED_IN_COOKIE, '003a1B2c', '003a1B2c')

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.lyric.param).toEqual({ songMID: '003a1B2c' })
  })

  it('真实数字 qqId 仍会作为 songID 发送', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ lyric: { data: { lyric: '[00:00.00]正确歌词' } } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await handleQQLyric(LOGGED_IN_COOKIE, '003a1B2c', '123456')

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.lyric.param).toEqual({ songMID: '003a1B2c', songID: 123456 })
  })
})

function mockVkeyResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        req_0: {
          code: 0,
          data: {
            midurlinfo: [{ purl: '', result: 104003, msg: '', tips: '', ...overrides }],
            sip: ['https://ws.stream.qqmusic.qq.com/'],
          },
        },
      }),
  }
}

describe('handleQQSongUrl restriction classification', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('flags a fee-tagged (VIP) song as paid_required instead of generic copyright_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockVkeyResponse()))
    const res = await handleQQSongUrl(LOGGED_IN_COOKIE, 'somemid', '', 'standard', '1')
    expect(res.playable).toBe(false)
    expect((res.restriction as { category: string }).category).toBe('paid_required')
  })

  it('keeps copyright_unavailable for the same upstream code when the track has no fee flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockVkeyResponse()))
    const res = await handleQQSongUrl(LOGGED_IN_COOKIE, 'somemid', '', 'standard', '0')
    expect(res.playable).toBe(false)
    expect((res.restriction as { category: string }).category).toBe('copyright_unavailable')
  })

  it('按音质优先级和 sip 顺序返回有限的多个播放地址', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        req_0: {
          code: 0,
          data: {
            midurlinfo: [
              { filename: 'M500somemid.mp3', purl: 'standard.mp3' },
              { filename: 'M800somemid.mp3', purl: 'exhigh.mp3' },
            ],
            sip: ['https://cdn-a.test/', 'https://cdn-b.test/'],
          },
        },
      }),
    }))

    const res = await handleQQSongUrl(LOGGED_IN_COOKIE, 'somemid', '', 'exhigh', '0')
    expect(res.url).toBe('https://cdn-a.test/exhigh.mp3')
    expect(res.candidates).toEqual([
      expect.objectContaining({ url: 'https://cdn-a.test/exhigh.mp3', level: 'exhigh' }),
      expect.objectContaining({ url: 'https://cdn-b.test/exhigh.mp3', level: 'exhigh' }),
      expect.objectContaining({ url: 'https://cdn-a.test/standard.mp3', level: 'standard' }),
      expect.objectContaining({ url: 'https://cdn-b.test/standard.mp3', level: 'standard' }),
    ])
  })

  it('歌曲 mid 与 mediaMid 不同时优先使用真实音频文件标识', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        req_0: {
          code: 0,
          data: {
            midurlinfo: [
              { filename: 'M500song-mid.mp3', purl: 'wrong-file.mp3' },
              { filename: 'M500file-mid.mp3', purl: 'right-file.mp3' },
            ],
            sip: ['https://cdn.test/'],
          },
        },
      }),
    }))

    const res = await handleQQSongUrl(LOGGED_IN_COOKIE, 'song-mid', 'file-mid', 'standard', '0')

    expect(res.filename).toBe('M500file-mid.mp3')
    expect(res.url).toBe('https://cdn.test/right-file.mp3')
  })
})
