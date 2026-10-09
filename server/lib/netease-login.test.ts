import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ status: vi.fn(), account: vi.fn() }))
vi.mock('NeteaseCloudMusicApi', () => ({ default: { login_status: h.status, user_account: h.account } }))
import { getCookie, setCookie } from './cookie'
import { getLoginInfo, requireLogin } from './netease-client'

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
  afterEach(() => { rmSync(ctx.userDataDir, { recursive: true, force: true }) })

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
