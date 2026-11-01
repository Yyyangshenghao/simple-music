import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { networkRoutes } from './network'
import { readProxySettings } from '../lib/proxy-config'

const h = vi.hoisted(() => ({
  applyUpstream: vi.fn(),
  setSystem: vi.fn(),
  diagnose: vi.fn(async () => ({ routes: [], systemProxy: '', hints: [] })),
  detect: vi.fn(async () => [{ address: 'http://127.0.0.1:7890', source: 'scan', label: 'Clash' }]),
}))
vi.mock('../lib/upstream-proxy', () => ({
  applyUpstreamProxy: h.applyUpstream,
  setSystemProxyAddress: h.setSystem,
  systemProxyAddress: () => 'http://127.0.0.1:1111',
}))
vi.mock('../lib/proxy-diagnostics', () => ({ diagnoseProxy: h.diagnose }))
vi.mock('../lib/proxy-detect', () => ({ detectProxyCandidates: h.detect }))

let dir = ''
let applied = 0
beforeEach(() => {
  vi.clearAllMocks()
  applied = 0
  resolveSystemProxy = undefined
  dir = mkdtempSync(join(tmpdir(), 'sm-network-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

let resolveSystemProxy: (() => Promise<string>) | undefined
function ctx() {
  return { userDataDir: dir, port: 0, applySessionProxy: vi.fn(() => { applied++ }), resolveSystemProxy }
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

  it('自定义却没填地址时拒绝保存', async () => {
    expect((await call('/api/network/proxy', 'POST', { mode: 'custom', url: '' })).body).toMatchObject({ error: '请填写代理地址' })
    expect(h.applyUpstream).not.toHaveBeenCalled()
  })

  it('诊断用草稿设置与现取的系统代理，并同步给 Node 侧', async () => {
    resolveSystemProxy = vi.fn(async () => 'http://u:p@127.0.0.1:7890')
    const settings = { mode: 'system', url: '', apple: 'inherit', appleUrl: '' }
    expect((await call('/api/network/proxy/diagnose', 'POST', { settings })).status).toBe(200)
    expect(h.diagnose).toHaveBeenCalledWith(settings, dir, 'http://u:p@127.0.0.1:7890')
    expect(h.setSystem).toHaveBeenCalledWith('http://u:p@127.0.0.1:7890')
    expect((await call('/api/network/proxy/diagnose', 'POST', { settings: { mode: 'bad' } })).status).toBe(400)
  })

  it('没有宿主或宿主读取失败时沿用已知系统代理', async () => {
    await call('/api/network/proxy/diagnose', 'POST', { settings: {} })
    expect(h.diagnose).toHaveBeenLastCalledWith(expect.anything(), dir, 'http://127.0.0.1:1111')
    resolveSystemProxy = vi.fn(async () => { throw new Error('boom') })
    await call('/api/network/proxy/diagnose', 'POST', { settings: {} })
    expect(h.diagnose).toHaveBeenLastCalledWith(expect.anything(), dir, 'http://127.0.0.1:1111')
  })

  it('读取系统代理时去掉账号密码', async () => {
    resolveSystemProxy = vi.fn(async () => 'http://u:p@127.0.0.1:7890')
    expect((await call('/api/network/proxy/system')).body).toEqual({ address: 'http://127.0.0.1:7890' })
  })

  it('自动检测返回候选', async () => {
    expect((await call('/api/network/proxy/detect', 'POST', {})).body).toEqual({ candidates: [{ address: 'http://127.0.0.1:7890', source: 'scan', label: 'Clash' }] })
    expect(h.detect).toHaveBeenCalledWith('http://127.0.0.1:1111')
  })

  it('不处理其他路径', async () => {
    expect((await call('/api/networks')).handled).toBe(false)
    expect((await call('/api/network/proxy/test', 'POST', {})).handled).toBe(false)
  })
})
