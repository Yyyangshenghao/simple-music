import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { networkRoutes } from './network'
import { readProxySettings } from '../lib/proxy-config'

const h = vi.hoisted(() => ({ applyUpstream: vi.fn(), dispatcher: { dispatch: vi.fn() }, fetch: vi.fn() }))
vi.mock('../lib/upstream-proxy', () => ({
  applyUpstreamProxy: h.applyUpstream,
  dispatcherForTarget: () => h.dispatcher,
}))

let dir = ''
let applied = 0
beforeEach(() => {
  vi.clearAllMocks()
  applied = 0
  dir = mkdtempSync(join(tmpdir(), 'sm-network-'))
  vi.stubGlobal('fetch', h.fetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

function ctx() {
  return { userDataDir: dir, port: 0, applySessionProxy: vi.fn(() => { applied++ }) }
}

async function call(path: string, method = 'GET', body?: unknown) {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const req = Object.assign(
    body === undefined ? Readable.from([]) : Readable.from([Buffer.from(JSON.stringify(body))]),
    { method, headers: {} },
  )
  const handled = await networkRoutes(req as unknown as IncomingMessage, res as unknown as ServerResponse, new URL(`http://localhost${path}`), ctx())
  return { handled, status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls[0] ? JSON.parse(res.end.mock.calls[0][0].toString()) : undefined }
}

describe('代理设置接口', () => {
  it('读取默认值', async () => {
    expect(await call('/api/network/proxy')).toMatchObject({ handled: true, status: 200, body: { mode: 'system', apple: 'inherit' } })
  })

  it('保存后落盘并同时切换 Node 与 Electron 会话', async () => {
    const settings = { mode: 'custom', url: 'http://127.0.0.1:7890', apple: 'direct', appleUrl: '' }
    expect(await call('/api/network/proxy', 'POST', settings)).toMatchObject({ status: 200, body: settings })
    expect(readProxySettings(dir)).toEqual(settings)
    expect(h.applyUpstream).toHaveBeenCalledWith(settings)
    expect(applied).toBe(1)
  })

  it('非法设置返回 400 且不落盘', async () => {
    expect((await call('/api/network/proxy', 'POST', { mode: 'socks' })).status).toBe(400)
    expect(h.applyUpstream).not.toHaveBeenCalled()
    expect(readProxySettings(dir)).toMatchObject({ mode: 'system' })
  })

  it('测试连接：成功返回状态与时延，失败返回可读原因', async () => {
    const settings = { mode: 'custom', url: 'http://127.0.0.1:7890', apple: 'inherit', appleUrl: '' }
    h.fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    const ok = await call('/api/network/proxy/test', 'POST', { settings })
    expect(ok.body).toMatchObject({ ok: true, status: 200 })
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ dispatcher: h.dispatcher })

    h.fetch.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { cause: { code: 'ECONNREFUSED' } }))
    const failed = await call('/api/network/proxy/test', 'POST', { settings })
    expect(failed.body).toMatchObject({ ok: false, error: '代理端口没有响应，请确认代理软件正在运行' })

    h.fetch.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
    expect((await call('/api/network/proxy/test', 'POST', { settings })).body).toMatchObject({ ok: false, error: '通过代理连接超时' })
  })

  it('Apple 出口可以单独测试', async () => {
    h.fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    await call('/api/network/proxy/test', 'POST', { settings: { apple: 'custom', appleUrl: 'http://127.0.0.1:7891' }, target: 'apple' })
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('不处理其他路径', async () => {
    expect((await call('/api/networks')).handled).toBe(false)
  })
})
