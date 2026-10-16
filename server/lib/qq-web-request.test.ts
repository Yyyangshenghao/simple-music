import { createDecipheriv } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { qqWebMusicRequest, qqWebSign } from './qq-web-request'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
// 固定版本qmweb-sign上游测试向量，避免只对实现自我往返。
it.each([
  ['123', 'zzcec1b555gzqzg7laztguyjl2bu20r6x1w50c55f60'],
  ['hello world', 'zzcfb3415bc4nfoxmd9uik71mkomtubjfjp141a1cbbcc'],
  ['jixun.uk', 'zzcf47b78apso27mjjbbzgbof0szikfkvyqc7fc3a2b5'],
])('zzc签名与上游已知向量一致：%s', (text, sign) => { expect(qqWebSign(text)).toBe(sign) })

const fixture = 'AR3vcjr+DTBcYVz/bBhmrSIJHD7gCEvTaS25FTtcfVKpa0g9/mtCC2i7WFnqezj9SWwKKxjteVw6+2gJEg=='
it('请求同一份JSON签名并ag-1加密，解码上游二进制向量；随机IV不复用', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(Buffer.from(fixture, 'base64')))
  vi.stubGlobal('fetch', fetchMock)
  const payload = { comm: { uin: '7' }, playlist: { module: '测试', param: { name: '中文' } } }
  await expect(qqWebMusicRequest('fixture-cookie', payload)).resolves.toEqual({ code: 0, ts: 0, start_ts: 100, traceid: 'ffffffffffffffff' })
  await qqWebMusicRequest('fixture-cookie', payload)
  const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
  expect(input.origin + input.pathname).toBe('https://u6.y.qq.com/cgi-bin/musics.fcg')
  expect(input.searchParams.get('encoding')).toBe('ag-1')
  expect(input.searchParams.get('sign')).toBe(qqWebSign(JSON.stringify(payload)))
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Cookie: 'fixture-cookie', 'Content-Type': 'text/plain' } })
  const raw = Buffer.from(String(init.body), 'base64')
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from([189, 48, 95, 16, 208, 255, 116, 182, 239, 84, 218, 184, 53, 181, 225, 207]), raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(-16))
  expect(Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString()).toBe(JSON.stringify(payload))
  expect(fetchMock.mock.calls[1][1].body).not.toBe(init.body)
})

it('不规范UTF-8文字不误报写失败，响应JSON结构仍须完整', async () => {
  const key = [122, 63, 140, 29, 94, 155, 47, 10, 108, 77, 126, 139, 31, 58, 92, 157, 14, 43, 111, 74, 129]
  const text = Buffer.concat([Buffer.from('{"code":0,"msg":"'), Buffer.from([0xff]), Buffer.from('"}')])
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(text.map((n, i) => n ^ key[i % key.length]))))
  await expect(qqWebMusicRequest('cookie', {})).resolves.toEqual({ code: 0, msg: '\uFFFD' })
})

it.each([new Uint8Array(), new Uint8Array([1, 2, 3])])('响应损坏不返回成功、不重试或切换明文 %j', async bytes => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(bytes))
  vi.stubGlobal('fetch', fetchMock)
  await expect(qqWebMusicRequest('cookie', {})).rejects.toThrow('响应无法解析')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('HTTP失败不解析为成功或自动重试', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('failed', { status: 503 }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(qqWebMusicRequest('cookie', {})).rejects.toThrow('HTTP 503')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('超时取消请求并给出状态待确认提示，不重发写入', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  vi.stubGlobal('fetch', fetchMock)
  const pending = expect(qqWebMusicRequest('cookie', {})).rejects.toThrow('请求超时')
  await vi.advanceTimersByTimeAsync(10_000)
  await pending
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
