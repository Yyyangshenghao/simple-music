import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectProxyCandidates, probeLocalProxy } from './proxy-detect'

const servers: Server[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  vi.unstubAllEnvs()
})

function listen(onData: (chunk: Buffer, reply: (data: Buffer | string) => void, end: () => void) => void): Promise<number> {
  const server = createServer((socket) => {
    socket.once('data', (chunk) => onData(chunk, (data) => socket.write(data), () => socket.destroy()))
  })
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)))
}

describe('本机代理探测', () => {
  it('识别 HTTP 代理（含要求认证的 407）', async () => {
    const port = await listen((chunk, reply) => {
      if (chunk.toString().startsWith('CONNECT')) reply('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')
    })
    expect(await probeLocalProxy(port)).toBe('http')
  })

  it('HTTP 不应答时识别 SOCKS5，断开连接也能及时结束', async () => {
    const port = await listen((chunk, reply, end) => {
      if (chunk[0] === 0x05) reply(Buffer.from([0x05, 0x00]))
      else end()
    })
    expect(await probeLocalProxy(port)).toBe('socks5')
  })

  it('不是代理的端口返回 null', async () => {
    const port = await listen((_chunk, reply) => reply('SSH-2.0-OpenSSH\r\n'))
    expect(await probeLocalProxy(port)).toBeNull()
    expect(await probeLocalProxy(1)).toBeNull()
  })

  it('候选按系统、环境变量去重排序', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:8001')
    for (const key of ['https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) vi.stubEnv(key, '')
    const candidates = await detectProxyCandidates('http://127.0.0.1:8001')
    expect(candidates[0]).toEqual({ address: 'http://127.0.0.1:8001', source: 'system', label: '系统代理' })
    expect(candidates.filter((candidate) => candidate.address === 'http://127.0.0.1:8001')).toHaveLength(1)
  })
})
