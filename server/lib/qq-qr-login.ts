import { randomUUID } from 'node:crypto'

/**
 * QQ 音乐扫码登录：QQ 扫码走 ptlogin2 → graph.qq.com 授权 → QQConnectLogin 换音乐票据；
 * 微信扫码走 open.weixin.qq.com → music.login 换票据。均为 y.qq.com 官网同款公开流程，
 * 协议参数以 2026-11 实测核对；最终产出与网页登录窗同形态的 Cookie，交给现有 QQ 会话链路。
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const QQ_APP_ID = '716027609'
const QQ_3RD_AID = '100497308'
const WX_APP_ID = 'wx48db31d50e334801'
const TIMEOUT_MS = 8000
const ALLOWED_HOSTS = new Set([
  'ssl.ptlogin2.qq.com', 'ptlogin2.qq.com', 'graph.qq.com', 'u.y.qq.com',
  'open.weixin.qq.com', 'lp.open.weixin.qq.com',
])
// check_sig 跳转地址由 ptlogin 返回，只认 QQ 自己的登录域。
const CHECK_SIG_HOST = /^(?:[a-z0-9-]+\.)*(?:ptlogin2\.qq\.com|qq\.com)$/i

export type QQQrType = 'qq' | 'wx'
export type QQFetch = (url: string, init: RequestInit) => Promise<Response>

export type QQQrState =
  | { status: 'waiting' | 'scanned' | 'expired' }
  | { status: 'confirmed'; cookie: string; nickname: string; avatar: string }

/** QQ 系 hash33：ptqrtoken 用 seed 0，g_tk 用 seed 5381。 */
export function qqHash33(text: string, seed = 0): number {
  let hash = seed
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  return hash & 0x7fffffff
}

function assertHost(url: string): void {
  const host = new URL(url).hostname
  if (!ALLOWED_HOSTS.has(host)) throw new Error('UNSAFE_UPSTREAM')
}

async function request(url: string, init: RequestInit, fetchImpl: QQFetch, timeoutMs = TIMEOUT_MS): Promise<Response> {
  assertHost(url)
  return fetchImpl(url, {
    redirect: 'manual',
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function setCookies(res: Response, base: Record<string, string> = {}): Record<string, string> {
  const jar = { ...base }
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(';')[0]
    const index = pair.indexOf('=')
    if (index <= 0) continue
    const name = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    if (name && value) jar[name] = value
  }
  return jar
}

const cookieHeader = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')

// ───────────────────────────── 生成二维码 ─────────────────────────────

export async function createQQQr(type: QQQrType, fetchImpl: QQFetch = fetch): Promise<{ key: string; image: string }> {
  if (type === 'wx') {
    const params = new URLSearchParams({
      appid: WX_APP_ID,
      redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/',
      response_type: 'code', scope: 'snsapi_login', state: 'STATE',
    })
    const page = await request(`https://open.weixin.qq.com/connect/qrconnect?${params}`, {}, fetchImpl)
    const uuid = /connect\/qrcode\/([A-Za-z0-9_-]{8,64})/.exec(await page.text())?.[1]
    if (!uuid) throw new Error('WX_QR_FAILED')
    const image = await request(`https://open.weixin.qq.com/connect/qrcode/${uuid}`, { headers: { Referer: 'https://open.weixin.qq.com/' } }, fetchImpl)
    if (!image.ok) throw new Error(`WX_QR_HTTP_${image.status}`)
    return { key: uuid, image: `data:image/jpeg;base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}` }
  }
  const res = await request(
    `https://ssl.ptlogin2.qq.com/ptqrshow?appid=${QQ_APP_ID}&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}&daid=383&pt_3rd_aid=${QQ_3RD_AID}`,
    { headers: { Referer: 'https://xui.ptlogin2.qq.com/' } }, fetchImpl,
  )
  const qrsig = setCookies(res).qrsig
  if (!res.ok || !qrsig) throw new Error('QQ_QR_FAILED')
  return { key: qrsig, image: `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}` }
}

// ───────────────────────────── 换音乐票据 ─────────────────────────────

interface MusicCredential { musicid?: unknown; str_musicid?: unknown; musickey?: unknown; refresh_key?: unknown; openid?: unknown; unionid?: unknown; refresh_token?: unknown; encryptUin?: unknown; loginType?: unknown; nick?: unknown; logo?: unknown }

async function musicLogin(module: string, method: string, param: Record<string, unknown>, loginType: number, fetchImpl: QQFetch): Promise<MusicCredential> {
  const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { Referer: 'https://y.qq.com/', 'Content-Type': 'application/json' },
    body: JSON.stringify({ comm: { g_tk: 5381, platform: 'yqq', ct: 24, cv: 0, tmeLoginType: loginType }, req: { module, method, param } }),
  }, fetchImpl)
  if (!res.ok) throw new Error(`QQ_LOGIN_HTTP_${res.status}`)
  const json = await res.json() as { req?: { code?: number; data?: MusicCredential } }
  const data = json.req?.data
  if (json.req?.code !== 0 || !data?.musickey || !data.musicid) throw new Error(`QQ_LOGIN_${json.req?.code ?? 'EMPTY'}`)
  return data
}

const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '')

/**
 * 票据 → 与网页端相同的 Cookie：QQ 登录 login_type=1 + uin；微信登录 login_type=2 + wxuin（o 前缀）
 * 与 wxopenid/wxrefresh_token，现有 qqCookieUin/qqCookieMusicKey 都能识别。
 */
export function qqCredentialCookie(cred: MusicCredential, type: QQQrType): string {
  // 微信账号的 musicid 是超过 2^53 的 64 位整数，JSON 数字会丢精度；优先用字符串版 str_musicid。
  const uin = text(cred.str_musicid) || text(cred.musicid)
  const key = text(cred.musickey)
  const jar: Record<string, string> = type === 'wx'
    ? {
        login_type: '2', wxuin: `o${uin.padStart(10, '0')}`, uin, qm_keyst: key, qqmusic_key: key,
        wxopenid: text(cred.openid), wxunionid: text(cred.unionid), wxrefresh_token: text(cred.refresh_token),
      }
    : { login_type: '1', uin, qm_keyst: key, qqmusic_key: key, psrf_qqopenid: text(cred.openid), psrf_qqrefresh_token: text(cred.refresh_token) }
  if (text(cred.refresh_key)) jar.psrf_musickey_createtime = String(Math.floor(Date.now() / 1000))
  return Object.entries(jar).filter(([, value]) => value).map(([k, v]) => `${k}=${v}`).join('; ')
}

// ───────────────────────────── 轮询状态 ─────────────────────────────

async function checkWx(uuid: string, last: string, fetchImpl: QQFetch): Promise<QQQrState> {
  // 长轮询：状态不变时上游挂起到超时，这里 20 秒放弃并按等待处理。
  const params = new URLSearchParams({ uuid, _: String(Date.now()), ...(last ? { last } : {}) })
  let body = ''
  try {
    const res = await request(`https://lp.open.weixin.qq.com/connect/l/qrconnect?${params}`, { headers: { Referer: 'https://open.weixin.qq.com/' } }, fetchImpl, 20_000)
    body = await res.text()
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') return { status: 'waiting' }
    throw err
  }
  const match = /wx_errcode=(\d+);window\.wx_code='([^']*)'/.exec(body)
  const errcode = Number(match?.[1])
  if (errcode === 405 && match?.[2]) {
    const cred = await musicLogin('music.login.LoginServer', 'Login', { code: match[2], strAppid: WX_APP_ID }, 1, fetchImpl)
    return { status: 'confirmed', cookie: qqCredentialCookie(cred, 'wx'), nickname: text(cred.nick), avatar: text(cred.logo) }
  }
  if (errcode === 404) return { status: 'scanned' }
  if (errcode === 402 || errcode === 403) return { status: 'expired' }
  return { status: 'waiting' }
}

async function checkQQ(qrsig: string, fetchImpl: QQFetch): Promise<QQQrState> {
  const params = new URLSearchParams({
    u1: 'https://graph.qq.com/oauth2.0/login_jump', ptqrtoken: String(qqHash33(qrsig)), ptredirect: '0', h: '1', t: '1', g: '1',
    from_ui: '1', ptlang: '2052', action: `0-0-${Date.now()}`, js_ver: '20102616', js_type: '1', pt_uistyle: '40',
    aid: QQ_APP_ID, daid: '383', pt_3rd_aid: QQ_3RD_AID, has_onekey: '1',
  })
  const res = await request(`https://ssl.ptlogin2.qq.com/ptqrlogin?${params}`, { headers: { Referer: 'https://xui.ptlogin2.qq.com/', Cookie: `qrsig=${qrsig}` } }, fetchImpl)
  const args = [...(/ptuiCB\((.*)\)/.exec(await res.text())?.[1] ?? '').matchAll(/'((?:\\.|[^'])*)'/g)].map((m) => m[1])
  const code = args[0]
  if (code === '65') return { status: 'expired' }
  if (code === '67') return { status: 'scanned' }
  if (code !== '0') return { status: 'waiting' }

  const jump = args[2] ?? ''
  if (!/^https:\/\//.test(jump) || !CHECK_SIG_HOST.test(new URL(jump).hostname)) throw new Error('QQ_JUMP_INVALID')
  const jar = setCookies(res, { qrsig })
  // check_sig 域名不在固定白名单里（ptlogin 分站），只放行 qq.com 后单独请求。
  const sig = await fetchImpl(jump, { redirect: 'manual', headers: { 'User-Agent': UA, Referer: 'https://xui.ptlogin2.qq.com/', Cookie: cookieHeader(jar) }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const session = setCookies(sig, jar)
  const pskey = session.p_skey
  if (!pskey) throw new Error('QQ_PSKEY_MISSING')
  const form = new URLSearchParams({
    response_type: 'code', client_id: QQ_3RD_AID,
    redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/',
    scope: 'get_user_info,get_app_friends', state: 'state', switch: '', from_ptlogin: '1', src: '1', update_auth: '1',
    openapi: '1010_1030', g_tk: String(qqHash33(pskey, 5381)), auth_time: String(Date.now()), ui: randomUUID(),
  })
  const auth = await request('https://graph.qq.com/oauth2.0/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://xui.ptlogin2.qq.com/', Cookie: cookieHeader(session) },
    body: form.toString(),
  }, fetchImpl)
  const authCode = /[?&]code=([^&]+)/.exec(auth.headers.get('location') ?? '')?.[1]
  if (!authCode) throw new Error('QQ_AUTH_CODE_MISSING')
  const cred = await musicLogin('QQConnectLogin.LoginServer', 'QQLogin', { code: authCode }, 2, fetchImpl)
  return { status: 'confirmed', cookie: qqCredentialCookie(cred, 'qq'), nickname: text(cred.nick) || args[5] || '', avatar: text(cred.logo) }
}

export function checkQQQr(type: QQQrType, key: string, last = '', fetchImpl: QQFetch = fetch): Promise<QQQrState> {
  return type === 'wx' ? checkWx(key, last, fetchImpl) : checkQQ(key, fetchImpl)
}
