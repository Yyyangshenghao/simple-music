import { createServer, type Server } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROXY_SETTINGS } from './proxy-config'

const h = vi.hoisted(() => ({ fetch: vi.fn(), probes: [] as string[] }))
vi.mock('./upstream-proxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./upstream-proxy')>()),
  withProbeDispatcher: async (address: string, run: (d: unknown) => Promise<unknown>) => { h.probes.push(address); return run({ address }) },
}))

import { describeNetworkError, detectSystemTakeover, diagnoseProxy, diagnosisHints, isFakeIp, parseTrace } from './proxy-diagnostics'

// 默认不让本机真实网络（例如开着 TUN）影响断言。
const clean = { lookup: async () => ['59.111.160.195'], interfaces: () => ['192.168.1.2'] }

const coded = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) })

let dir = ''
let server: Server | null = null
beforeEach(() => {
  h.fetch.mockReset()
  h.probes.length = 0
  vi.stubGlobal('fetch', h.fetch)
  dir = mkdtempSync(join(tmpdir(), 'sm-diag-'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  server?.close()
  server = null
  rmSync(dir, { recursive: true, force: true })
})

function listen(): Promise<number> {
  server = createServer((socket) => socket.destroy())
  return new Promise((resolve) => server!.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port)))
}

function respondAll(trace = 'ip=1.2.3.4\nloc=US\n') {
  h.fetch.mockImplementation(async (url: string) => ({ ok: true, status: url.includes('trace') ? 200 : 301, text: async () => trace }))
}

describe('网络错误翻译', () => {
  it('区分代理认证、端口、超时、解析、TLS 与重置', () => {
    expect(describeNetworkError(new Error('Proxy response (407) !== 200 when HTTP Tunneling'), true)).toBe('代理需要认证或账号密码不正确')
    expect(describeNetworkError(Object.assign(new Error('x'), { cause: new Error('Proxy response (502) !== 200 when HTTP Tunneling') }), true)).toBe('代理拒绝了连接（502）')
    expect(describeNetworkError(coded('ECONNREFUSED'), true)).toBe('代理端口没有响应，请确认代理软件正在运行')
    expect(describeNetworkError(coded('ENOTFOUND'), false)).toBe('域名解析失败，请检查网络或 DNS')
    expect(describeNetworkError(Object.assign(new Error('t'), { name: 'TimeoutError' }), true)).toBe('通过代理连接超时，节点可能不可用')
    expect(describeNetworkError(coded('UND_ERR_CONNECT_TIMEOUT'), false)).toBe('连接超时')
    expect(describeNetworkError(coded('ECONNRESET'), false)).toBe('连接被重置，可能被网络拦截')
    expect(describeNetworkError(coded('CERT_HAS_EXPIRED'), true)).toBe('证书校验失败，网络或代理可能在篡改 HTTPS')
    expect(describeNetworkError(new Error('?'), true)).toBe('通过代理连接失败')
  })

  it('解析 Cloudflare trace', () => {
    expect(parseTrace('fl=1\nip=1.2.3.4\nloc=JP\n')).toEqual({ ip: '1.2.3.4', country: 'JP' })
    expect(parseTrace('ip=::1\nloc=XX1\n')).toEqual({ ip: '::1', country: undefined })
  })
})

describe('代理诊断', () => {
  it('直连：检查三个平台与出口，合并成一条线路', async () => {
    respondAll('ip=1.2.3.4\nloc=CN\n')
    const result = await diagnoseProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' }, dir, '', clean)
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0]).toMatchObject({ target: 'default', address: '', source: 'direct' })
    expect(result.routes[0].checks.map((check) => [check.id, check.ok])).toEqual([['netease', true], ['qq', true], ['apple', true], ['egress', true]])
    expect(result.routes[0].checks[3]).toMatchObject({ ip: '1.2.3.4', country: 'CN' })
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD', redirect: 'manual' })
    expect(result.hints).toEqual([])
  })

  it('Apple 单独出口时分成两条，并对比账号地区', async () => {
    const port = await listen()
    respondAll()
    writeFileSync(join(dir, 'apple-music-storefront'), 'jp')
    const result = await diagnoseProxy({ mode: 'direct', url: '', apple: 'custom', appleUrl: `http://u:p@127.0.0.1:${port}` }, dir, '', clean)
    expect(result.routes.map((route) => route.target)).toEqual(['default', 'apple'])
    expect(result.routes[1]).toMatchObject({ address: `http://127.0.0.1:${port}`, source: 'custom', proxyReachable: true })
    expect(result.routes[1].checks.map((check) => check.id)).toEqual(['apple', 'egress'])
    expect(h.probes).toContain(`http://u:p@127.0.0.1:${port}`)
    expect(result.hints.some((hint) => hint.includes('账号地区为日本') && hint.includes('美国'))).toBe(true)
  })

  it('代理端口连不上时不再逐站请求', async () => {
    const result = await diagnoseProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'custom', url: 'http://127.0.0.1:1' }, dir, '', clean)
    expect(result.routes[0]).toMatchObject({ proxyReachable: false, proxyError: '代理端口没有响应，请确认代理软件正在运行' })
    expect(result.routes[0].checks.every((check) => !check.ok && check.error === '代理不可用，未检测')).toBe(true)
    expect(h.fetch).not.toHaveBeenCalled()
    expect(result.hints[0]).toContain('代理端口没有响应')
  })

  it('跟随系统使用传入的系统代理', async () => {
    const port = await listen()
    respondAll()
    const result = await diagnoseProxy(DEFAULT_PROXY_SETTINGS, dir, `http://127.0.0.1:${port}`, clean)
    expect(result.routes[0]).toMatchObject({ source: 'system', address: `http://127.0.0.1:${port}` })
    expect(result.systemProxy).toBe(`http://127.0.0.1:${port}`)
  })

  it('站点返回 407/5xx 记为失败', async () => {
    h.fetch.mockImplementation(async (url: string) => ({ ok: false, status: url.includes('163') ? 407 : 503, text: async () => '' }))
    const result = await diagnoseProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' }, dir, '', clean)
    expect(result.routes[0].checks[0]).toMatchObject({ ok: false, error: '代理需要认证或账号密码不正确' })
    expect(result.routes[0].checks[1]).toMatchObject({ ok: false, error: '服务器返回 503' })
  })
})

describe('响应过慢', () => {
  it('超过阈值标记 slow，并按直连/代理给出不同建议', async () => {
    // 只拦 Date，避免假计时器影响诊断里的 socket 与超时信号。
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    h.fetch.mockImplementation(async (url: string) => {
      if (url.includes('apple')) await new Promise((resolve) => setTimeout(resolve, 7314))
      return { ok: true, status: 200, text: async () => 'ip=1.2.3.4\nloc=CN\n' }
    })
    const pending = diagnoseProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' }, dir, '', clean)
    await vi.advanceTimersByTimeAsync(7314)
    const result = await pending
    vi.useRealTimers()
    const apple = result.routes[0].checks.find((check) => check.id === 'apple')!
    expect(apple).toMatchObject({ ok: true, slow: true })
    expect(result.routes[0].checks.find((check) => check.id === 'netease')!.slow).toBeUndefined()
    expect(result.hints).toEqual(['Apple Music 直连响应很慢（7.3 秒），曲库加载与起播可能卡顿，可以把 Apple Music 出口设为单独代理'])
  })

  it('经代理慢时建议换节点', () => {
    const hints = diagnosisHints({
      systemProxy: '',
      routes: [{ target: 'default', address: 'http://127.0.0.1:7890', source: 'custom', checks: [
        { id: 'netease', ok: true, elapsedMs: 4200, slow: true }, { id: 'egress', ok: true, elapsedMs: 1, country: 'CN' },
      ] }],
    }, { ...DEFAULT_PROXY_SETTINGS, mode: 'custom', url: 'http://127.0.0.1:7890' }, '')
    expect(hints).toEqual(['经 http://127.0.0.1:7890 访问网易云音乐很慢（4.2 秒），节点可能拥堵，可以换节点，或让默认出口直连'])
  })
})

describe('系统级接管（TUN）', () => {
  it('fake-ip 网段识别', () => {
    expect(isFakeIp('198.18.0.6')).toBe(true)
    expect(isFakeIp('198.19.255.1')).toBe(true)
    expect(isFakeIp('198.20.0.1')).toBe(false)
    expect(isFakeIp('::1')).toBe(false)
  })

  it('虚拟网卡或域名解析到 fake-ip 即判定接管；查询失败不误报', async () => {
    expect(await detectSystemTakeover({ lookup: async () => ['1.2.3.4'], interfaces: () => ['198.18.0.1'] })).toBe(true)
    expect(await detectSystemTakeover({ lookup: async (host) => (host === 'music.163.com' ? ['198.18.0.6'] : ['1.2.3.4']), interfaces: () => [] })).toBe(true)
    expect(await detectSystemTakeover(clean)).toBe(false)
    expect(await detectSystemTakeover({ lookup: async () => { throw new Error('dns') }, interfaces: () => { throw new Error('os') } })).toBe(false)
  })

  it('直连线路被接管时说明实际出口，并替代“系统未开代理”的结论', async () => {
    respondAll()
    const tun = { lookup: async () => ['198.18.0.6'], interfaces: () => [] }
    const result = await diagnoseProxy(DEFAULT_PROXY_SETTINGS, dir, '', tun)
    expect(result.systemTakeover).toBe(true)
    expect(result.hints[0]).toBe('检测到代理软件的 TUN/增强模式接管了系统网络，选“直连”的流量也会经过代理节点（实际出口在美国）；要真正直连，请在代理软件里关闭 TUN，或为相关域名设置直连规则')
    expect(result.hints.some((hint) => hint.includes('系统当前没有开启代理'))).toBe(false)
  })

  it('全部经代理时不提示接管', () => {
    const hints = diagnosisHints({
      systemProxy: '', systemTakeover: true,
      routes: [{ target: 'default', address: 'http://127.0.0.1:7890', source: 'custom', checks: [{ id: 'egress', ok: true, elapsedMs: 1, country: 'CN' }] }],
    }, { ...DEFAULT_PROXY_SETTINGS, mode: 'custom', url: 'http://127.0.0.1:7890' }, '')
    expect(hints).toEqual([])
  })
})

describe('诊断结论', () => {
  const route = (overrides: object) => ({ target: 'default' as const, address: '', source: 'direct' as const, checks: [], ...overrides })

  it('系统未开代理、出口在海外、全部同因失败', () => {
    const hints = diagnosisHints({
      systemProxy: '',
      routes: [route({ checks: [{ id: 'netease', ok: false, elapsedMs: 0, error: '连接超时' }, { id: 'egress', ok: false, elapsedMs: 0, error: '连接超时' }] })],
    }, DEFAULT_PROXY_SETTINGS, '')
    expect(hints).toEqual(['系统当前没有开启代理，跟随系统等同直连', '直连：连接超时'])

    const overseas = diagnosisHints({
      systemProxy: 'http://127.0.0.1:7890',
      routes: [route({ address: 'http://127.0.0.1:7890', source: 'system', checks: [{ id: 'netease', ok: true, elapsedMs: 1 }, { id: 'egress', ok: true, elapsedMs: 1, country: 'HK' }] })],
    }, DEFAULT_PROXY_SETTINGS, 'hk')
    expect(overseas).toEqual(['默认出口在中国香港特别行政区，网易云与 QQ 音乐的部分歌曲可能因版权地区限制无法播放'])
  })
})
