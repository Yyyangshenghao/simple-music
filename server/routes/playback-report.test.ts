import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ cookie: 'MUSIC_U=account-a', call: vi.fn(), qq: vi.fn() }))
vi.mock('../lib/cookie', async (original) => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: () => h.cookie }))
vi.mock('../lib/netease-client', async (original) => ({ ...await original<typeof import('../lib/netease-client')>(), call: h.call }))
vi.mock('../lib/qq-playback-report', () => ({ reportQQPlayback: h.qq }))
import { playbackAccountToken } from '../lib/playback-account'
import { neteaseRoutes } from './netease'
import { qqRoutes } from './qq-music'

async function request(source: 'netease' | 'qq', body?: Record<string, unknown>, method = 'POST', path = 'scrobble') {
  const req = Readable.from([Buffer.from(JSON.stringify(body ?? {}))]) as IncomingMessage
  req.method = method
  const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() }
  await (source === 'netease' ? neteaseRoutes : qqRoutes)(req, res as unknown as ServerResponse,
    new URL(`http://localhost/api/${source}/${path}`), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0].toString()), res }
}

describe('平台收听上报', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.cookie = 'MUSIC_U=account-a'
    h.call.mockResolvedValue({ status: 200, body: { code: 200 } })
    h.qq.mockResolvedValue(undefined)
  })

  it.each(['netease', 'qq'] as const)('%s 捕获不暴露Cookie的账号凭证，换号旧凭证不能上报', async (source) => {
    const session = await request(source, undefined, 'GET', 'playback/session')
    expect(session.body.accountToken).toBe(playbackAccountToken('MUSIC_U=account-a'))
    expect(session.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    h.cookie = 'MUSIC_U=account-b'
    expect(await request(source, { id: 123, time: 25, accountToken: session.body.accountToken })).toMatchObject({ status: 409 })
    expect(h.call).not.toHaveBeenCalled()
    expect(h.qq).not.toHaveBeenCalled()
  })

  it('网易补最近播放日志并按真实收听秒数上报排行', async () => {
    expect(await request('netease', { id: 123, time: 25.9, accountToken: playbackAccountToken(h.cookie) })).toMatchObject({ status: 200, body: { ok: true } })
    expect(h.call.mock.calls[0][0]).toBe('weblog')
    expect(JSON.parse(h.call.mock.calls[0][1].data.logs)[0]).toMatchObject({ action: 'startplay', json: { id: '123' } })
    expect(h.call.mock.calls[1][0]).toBe('weblog')
    expect(JSON.parse(h.call.mock.calls[1][1].data.logs)[0]).toMatchObject({ action: 'play', json: { id: '123', sourceId: '123', time: 25 } })
    expect(h.call.mock.calls[1][1]).toMatchObject({ crypto: 'eapi', domain: 'https://clientlog.music.163.com', cookie: 'MUSIC_U=account-a; os=osx' })
  })

  it('网易上游拒绝不能报告成功；两次上报间换号不发第二次', async () => {
    const body = { id: 123, time: 25, accountToken: playbackAccountToken(h.cookie) }
    h.call.mockResolvedValueOnce({ body: { code: 500 } })
    expect(await request('netease', body)).toMatchObject({ status: 502, body: { ok: false } })
    expect(h.call).toHaveBeenCalledTimes(1)
    h.call.mockClear().mockImplementationOnce(async () => { h.cookie = 'MUSIC_U=account-b'; return { body: { code: 200 } } })
    expect(await request('netease', body)).toMatchObject({ status: 409 })
    expect(h.call).toHaveBeenCalledTimes(1)
  })

  it('QQ 使用绑定账号和实际曲目，收集响应只标记已提交', async () => {
    const token = playbackAccountToken(h.cookie)
    expect(await request('qq', { id: 'qqmid', songId: 123, time: 25, accountToken: token })).toMatchObject({ status: 200, body: { ok: true, status: 'submitted' } })
    expect(h.qq).toHaveBeenCalledWith('MUSIC_U=account-a', 'qqmid', 123, 25, expect.any(Function))
  })

  it.each(['netease', 'qq'] as const)('%s 不接受GET写入、非法时长或未登录上报', async (source) => {
    expect(await request(source, undefined, 'GET')).toMatchObject({ status: 405 })
    for (const time of [-1, null, 'Infinity', 'NaN', 86401]) {
      expect(await request(source, { id: 123, time, accountToken: playbackAccountToken(h.cookie) })).toMatchObject({ status: 400 })
    }
    h.cookie = ''
    expect(await request(source, { id: 123, time: 25 })).toMatchObject({ body: { ok: false } })
    expect(h.call).not.toHaveBeenCalled()
    expect(h.qq).not.toHaveBeenCalled()
  })
})
