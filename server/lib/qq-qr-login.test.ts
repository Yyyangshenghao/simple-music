import { describe, expect, it, vi } from 'vitest'
import { checkQQQr, qqCredentialCookie, qqHash33 } from './qq-qr-login'
import { parseCookieString, qqCookieMusicKey, qqCookieUin } from './qq-client'

const text = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers })

describe('QQ 扫码登录', () => {
  it('hash33 与官网算法一致（ptqrtoken seed 0、g_tk seed 5381）', () => {
    expect(qqHash33('')).toBe(0)
    expect(qqHash33('', 5381)).toBe(5381)
    expect(qqHash33('abc')).toBe(((((97 * 33) + 98) * 33) + 99) & 0x7fffffff)
  })

  it('票据转出的 Cookie 能被现有 QQ 会话识别；微信用 wxuin 与 login_type=2', () => {
    const qq = parseCookieString(qqCredentialCookie({ musicid: 2471117875, musickey: 'Q_H_L_key', openid: 'o', refresh_token: 'r' }, 'qq'))
    expect(qqCookieUin(qq)).toBe('2471117875')
    expect(qqCookieMusicKey(qq)).toBe('Q_H_L_key')
    const wx = parseCookieString(qqCredentialCookie({ musicid: 123, musickey: 'W_X_key' }, 'wx'))
    expect(wx.login_type).toBe('2')
    expect(wx.wxuin).toBe('o0000000123')
    expect(qqCookieMusicKey(wx)).toBe('W_X_key')
    // 64 位 musicid 不能经 number 丢精度。
    const big = parseCookieString(qqCredentialCookie({ musicid: 1152921505387486200, str_musicid: '1152921505387486213', musickey: 'K' }, 'wx'))
    expect(big.uin).toBe('1152921505387486213')
  })

  it('ptqrlogin 状态码映射：66 等待、67 已扫、65 过期', async () => {
    const reply = (code: string) => vi.fn(async () => text(`ptuiCB('${code}','0','','0','提示', '')`))
    expect(await checkQQQr('qq', 'qrsig-test', '', reply('66'))).toEqual({ status: 'waiting' })
    expect(await checkQQQr('qq', 'qrsig-test', '', reply('67'))).toEqual({ status: 'scanned' })
    expect(await checkQQQr('qq', 'qrsig-test', '', reply('65'))).toEqual({ status: 'expired' })
  })

  it('登录成功的跳转地址不是 qq.com 时拒绝继续', async () => {
    const fetchImpl = vi.fn(async () => text(`ptuiCB('0','0','https://evil.example/check_sig?uin=1&','0','登录成功！', 'A.M')`))
    await expect(checkQQQr('qq', 'qrsig-test', '', fetchImpl)).rejects.toThrow('QQ_JUMP_INVALID')
  })

  it('微信长轮询：404 已扫、402 过期、405 用 code 换票据', async () => {
    const lp = (body: string) => vi.fn(async () => text(body))
    expect(await checkQQQr('wx', 'uuid-test-1', '', lp("window.wx_errcode=404;window.wx_code='';"))).toEqual({ status: 'scanned' })
    expect(await checkQQQr('wx', 'uuid-test-1', '404', lp("window.wx_errcode=402;window.wx_code='';"))).toEqual({ status: 'expired' })
    const fetchImpl = vi.fn(async (url: string) => url.includes('lp.open.weixin')
      ? text("window.wx_errcode=405;window.wx_code='CODE';")
      : new Response(JSON.stringify({ req: { code: 0, data: { musicid: 9, musickey: 'K', nick: '微信用户', logo: 'L' } } })))
    const state = await checkQQQr('wx', 'uuid-test-1', '404', fetchImpl)
    expect(state).toMatchObject({ status: 'confirmed', nickname: '微信用户', avatar: 'L' })
    const body = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(body.req).toMatchObject({ module: 'music.login.LoginServer', method: 'Login', param: { code: 'CODE' } })
  })
})
