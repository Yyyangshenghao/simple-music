import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleQQSongUrl } from './qq-client'

const LOGGED_IN_COOKIE = 'uin=12345; qm_keyst=some-key-value'

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
})
