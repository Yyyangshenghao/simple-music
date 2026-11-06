import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ status: vi.fn(), account: vi.fn() }))
vi.mock('NeteaseCloudMusicApi', () => ({ default: { login_status: h.status, user_account: h.account } }))
import { getCookie, setCookie } from './cookie'
import { getLoginInfo, requireLogin } from './netease-client'
import { startServer } from '../index'

describe('网易登录检查的 Cookie 会话隔离', () => {
  let ctx: { userDataDir: string; port: number }
  const invalid = { status: 301, body: { code: 301, msg: '需要登录' }, cookie: [] }
  const profile = { status: 200, body: { profile: { userId: 7, nickname: '旧账号' } }, cookie: [] }

  beforeEach(() => {
    vi.resetAllMocks()
    ctx = { userDataDir: mkdtempSync(join(tmpdir(), 'simplemusic-login-test-')), port: 0 }
    setCookie(ctx, 'netease', 'MUSIC_U=old')
    h.status.mockResolvedValue({ status: 200, body: { data: {} }, cookie: [] })
    h.account.mockResolvedValue(invalid)
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(ctx.userDataDir, { recursive: true, force: true })
  })

  it('同一 Cookie 的并发和短期重复查询只核实一次账号', async () => {
    h.status.mockResolvedValue(profile)
    const results = await Promise.all([getLoginInfo(ctx), getLoginInfo(ctx), getLoginInfo(ctx)])
    expect(results.every(info => info.loggedIn && info.userId === 7)).toBe(true)
    await getLoginInfo(ctx)
    expect(h.status).toHaveBeenCalledTimes(1)
  })

  it('成功资料缓存 30 秒后重新核实', async () => {
    vi.useFakeTimers()
    h.status.mockResolvedValue(profile)
    await getLoginInfo(ctx)
    await vi.advanceTimersByTimeAsync(30_001)
    await getLoginInfo(ctx)
    expect(h.status).toHaveBeenCalledTimes(2)
  })

  it('更换或清除 Cookie 后不复用成功资料', async () => {
    h.status.mockResolvedValue(profile)
    await getLoginInfo(ctx)
    setCookie(ctx, 'netease', 'MUSIC_U=new')
    h.status.mockResolvedValue({ ...profile, body: { profile: { userId: 8 } } })
    expect(await getLoginInfo(ctx)).toMatchObject({ loggedIn: true, userId: 8 })
    expect(h.status).toHaveBeenCalledTimes(2)
    setCookie(ctx, 'netease', '')
    expect(await getLoginInfo(ctx)).toMatchObject({ loggedIn: false })
  })

  it('网络错误不缓存为未登录，下一次仍能恢复资料', async () => {
    h.status.mockRejectedValueOnce(new Error('network'))
    h.account.mockRejectedValueOnce(new Error('network'))
    expect(await getLoginInfo(ctx)).toMatchObject({ loggedIn: false, hasCookie: true })
    h.status.mockResolvedValue(profile)
    expect(await getLoginInfo(ctx)).toMatchObject({ loggedIn: true, userId: 7 })
  })

  it.each(['resolve', 'reject'])('账号核实遇到明确风控（%s）不再请求备用接口，也不清 Cookie', async mode => {
    const limited = { status: 400, body: { code: -460 }, cookie: [] }
    if (mode === 'resolve') h.status.mockResolvedValue(limited)
    else h.status.mockRejectedValue(limited)
    await expect(getLoginInfo(ctx)).rejects.toThrow('NETEASE_RATE_LIMITED')
    expect(h.account).not.toHaveBeenCalled()
    expect(getCookie(ctx, 'netease')).toBe('MUSIC_U=old')
  })

  it('requireLogin 遭风控时不回 401，也不清除 Cookie', async () => {
    h.status.mockRejectedValue({ status: 400, body: { code: -460 } })
    const send = vi.fn()
    await expect(requireLogin({} as ServerResponse, ctx, send)).rejects.toThrow('NETEASE_RATE_LIMITED')
    expect(send).not.toHaveBeenCalled()
    expect(getCookie(ctx, 'netease')).toBe('MUSIC_U=old')
  })

  it('登录状态 HTTP 接口遭风控返回请求失败，不返回权威未登录', async () => {
    h.status.mockRejectedValue({ status: 400, body: { code: -460 } })
    const server = await startServer({ userDataDir: ctx.userDataDir, token: 'test-token' })
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/login/status?token=test-token`)
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toContain('NETEASE_RATE_LIMITED')
      expect(body.loggedIn).toBeUndefined()
      expect(getCookie(ctx, 'netease')).toBe('MUSIC_U=old')
    } finally { server.close() }
  })

  it.each(['resolve', 'reject'])('备用账号查询遭风控（%s）不误报未登录', async mode => {
    const limited = { status: 400, body: { code: -460 }, cookie: [] }
    if (mode === 'resolve') h.account.mockResolvedValue(limited)
    else h.account.mockRejectedValue(limited)
    await expect(getLoginInfo(ctx)).rejects.toThrow('NETEASE_RATE_LIMITED')
    expect(getCookie(ctx, 'netease')).toBe('MUSIC_U=old')
  })

  it('旧账号失效响应不能清除新 Cookie', async () => {
    h.account.mockImplementation(async () => {
      setCookie(ctx, 'netease', 'MUSIC_U=new')
      return invalid
    })
    expect(await getLoginInfo(ctx)).toMatchObject({ loggedIn: false, hasCookie: true })
    expect(getCookie(ctx, 'netease')).toBe('MUSIC_U=new')
  })

  it.each(['status', 'account'] as const)('切账号后丢弃 %s 返回的旧身份', async (stage) => {
    h[stage].mockImplementation(async () => {
      setCookie(ctx, 'netease', 'MUSIC_U=new')
      return profile
    })
    const info = await getLoginInfo(ctx)
    expect(info.loggedIn).toBe(false)
    expect(info.userId).toBeUndefined()
    expect(getCookie(ctx, 'netease')).toBe('MUSIC_U=new')
  })

  it('旧状态检查失败后不再用旧 Cookie 降级查询', async () => {
    h.status.mockImplementation(async () => {
      setCookie(ctx, 'netease', 'MUSIC_U=new')
      throw new Error('old request failed')
    })
    expect(await getLoginInfo(ctx)).toMatchObject({ loggedIn: false, hasCookie: true })
    expect(h.account).not.toHaveBeenCalled()
  })

  it('requireLogin 拒绝把旧身份与新 Cookie 组合成授权', async () => {
    h.status.mockImplementation(async () => {
      setCookie(ctx, 'netease', 'MUSIC_U=new')
      return profile
    })
    const send = vi.fn()
    expect(await requireLogin({} as ServerResponse, ctx, send)).toBeNull()
    expect(send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ error: 'ACCOUNT_CHANGED' }), 409)
  })

  it('同一会话确实失效时仍清除旧 Cookie', async () => {
    expect(await getLoginInfo(ctx)).toMatchObject({ loggedIn: false, hasCookie: false })
    expect(getCookie(ctx, 'netease')).toBe('')
  })

  it('requireLogin 对确实失效的同一会话保留 401', async () => {
    const send = vi.fn()
    expect(await requireLogin({} as ServerResponse, ctx, send)).toBeNull()
    expect(send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ error: 'LOGIN_REQUIRED' }), 401)
  })

  it('同一会话成功时保留正常身份', async () => {
    h.status.mockResolvedValue(profile)
    expect(await getLoginInfo(ctx)).toMatchObject({ loggedIn: true, userId: 7 })
  })
})
