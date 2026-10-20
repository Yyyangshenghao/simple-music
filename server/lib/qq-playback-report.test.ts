import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ detail: vi.fn(), report: vi.fn() }))
vi.mock('./qq-client', async (original) => ({ ...await original<typeof import('./qq-client')>(), qqMusicRequest: h.detail, requestText: h.report }))
import { reportQQPlayback } from './qq-playback-report'

describe('QQ官网收听通道', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.detail.mockResolvedValue({ songinfo: { code: 0, data: { track_info: { id: 123, mid: 'mid' } } } })
    h.report.mockResolvedValue('')
  })

  it('通过mid补数字ID，发送实际收听秒数与原账号Cookie', async () => {
    await reportQQPlayback('uin=o12345; qqmusic_key=example', 'mid', undefined, 25, () => true)
    const [target, options] = h.report.mock.calls[0]
    const url = new URL(target)
    expect(url.origin).toBe('https://stat6.y.qq.com')
    expect(url.searchParams.get('Fsong_id')).toBe('123')
    expect(url.searchParams.get('Fplay_time')).toBe('25')
    expect(url.searchParams.get('Fqq')).toBe('12345')
    expect(options.headers.Cookie).toBe('uin=o12345; qqmusic_key=example')
  })

  it('详情不是同曲或查询中换账号时不发送统计；有效数字ID免查询', async () => {
    await expect(reportQQPlayback('uin=123', 'mid', undefined, 25, () => false)).rejects.toThrow('ACCOUNT_CHANGED')
    expect(h.report).not.toHaveBeenCalled()
    h.detail.mockResolvedValueOnce({ songinfo: { code: 0, data: { track_info: { id: 456, mid: 'wrong' } } } })
    await expect(reportQQPlayback('uin=123', 'mid', undefined, 25, () => true)).rejects.toThrow('SONG_ID_UNAVAILABLE')
    expect(h.report).not.toHaveBeenCalled()
    h.detail.mockClear()
    await reportQQPlayback('uin=123', 'mid', 123, 25, () => true)
    expect(h.detail).not.toHaveBeenCalled()
    expect(h.report).toHaveBeenCalledOnce()
  })
})
