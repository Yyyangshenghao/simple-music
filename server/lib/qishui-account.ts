import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchQishuiPlaylist, mapQishuiPlaylists } from './qishui-client'

const origin = 'https://api.qishui.com'
const passport = { aid: '386088', passport_jssdk_version: '2.4.13', passport_jssdk_type: 'normal', is_from_ttaccountsdk: '1' }
const qrParams = { next: origin, need_logo: 'false', need_short_url: 'false', is_new_login: '1' }
const installId = '27960026095955'
const passportPollParams = { ...passport, iid: installId }
const accountParams = { aid: passport.aid, iid: installId, version_code: '30020100' }
const accountUserAgent = 'LunaPC/3.0.0(290101097)'
const expiredCode = 1000016
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const sessionFile = (dir: string) => join(dir, 'qishui-account.json')

interface Ticket {
  key: string
  token: string
  cookies: string
  expires: number
  checking?: boolean
  session?: string
  account?: { loggedIn: true; nickname: string }
}

const pending = new Map<string, Ticket>()
const sessionPattern = /^[A-Za-z0-9._~-]{1,512}$/

async function request(path: string, params: Record<string, string>, init?: RequestInit) {
  const response = await fetch(`${origin}${path}?${new URLSearchParams(params)}`, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': userAgent, ...init?.headers },
  })
  if (!response.ok) throw new Error('汽水音乐账号请求失败')
  const body = await response.json()
  const cookies = response.headers.getSetCookie().map(cookie => cookie.split(';', 1)[0])
  return { body, cookies }
}

async function profile(session: string): Promise<{ loggedIn: false } | { loggedIn: true; nickname: string }> {
  const { body } = await request('/luna/pc/me', { aid: passport.aid }, { headers: {
    'User-Agent': accountUserAgent, Cookie: `sessionid=${session}`,
  } })
  if (body.status_code === expiredCode) return { loggedIn: false }
  const user = body.my_info ?? body.user ?? body
  if (!user.id) throw new Error('汽水音乐未返回账号资料')
  return { loggedIn: true, nickname: String(user.nickname ?? user.name ?? '') }
}

export async function startQishuiLogin(dir: string) {
  const ticket: Ticket = { key: randomUUID(), token: '', cookies: '', expires: Date.now() + 180_000 }
  pending.set(dir, ticket)
  try {
    const { body, cookies } = await request('/passport/web/get_qrcode/', { ...passport, ...qrParams })
    const { token, qrcode, expire_time } = body.data ?? {}
    if (pending.get(dir) !== ticket || typeof token !== 'string' || !token ||
      typeof qrcode !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qrcode)) {
      throw new Error('汽水音乐未返回有效二维码')
    }
    ticket.token = token
    ticket.cookies = cookies.join('; ')
    if (Number.isFinite(expire_time)) ticket.expires = Math.min(ticket.expires, expire_time * 1000)
    return { key: ticket.key, image: qrcode }
  } catch (error) {
    if (pending.get(dir) === ticket) pending.delete(dir)
    throw error
  }
}

export async function pollQishuiLogin(dir: string, key: string | null) {
  const ticket = pending.get(dir)
  if (!ticket || ticket.key !== key || !ticket.token) return { status: 'expired' }
  if (ticket.expires <= Date.now()) {
    pending.delete(dir)
    return { status: 'expired' }
  }
  if (ticket.account) return { status: 'confirmed' }
  if (ticket.checking) return { status: 'waiting' }
  ticket.checking = true
  try {
    const { body, cookies } = ticket.session ? {} : await request('/passport/web/check_qrconnect/', passportPollParams, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: ticket.cookies },
      body: new URLSearchParams({ ...qrParams, token: ticket.token, is_frontier: 'true' }),
    })
    if (pending.get(dir) !== ticket || ticket.expires <= Date.now()) return { status: 'expired' }
    const session = cookies?.find(cookie => /^sessionid(?:_ss)?=/.test(cookie))?.split('=', 2)[1]
    if (session && sessionPattern.test(session)) ticket.session = session
    if (ticket.session) {
      const account = await profile(ticket.session)
      if (pending.get(dir) !== ticket || ticket.expires <= Date.now()) return { status: 'expired' }
      if (!account.loggedIn) {
        pending.delete(dir)
        return { status: 'failed', message: '汽水音乐未能核实登录账号' }
      }
      ticket.account = account
      return { status: 'confirmed' }
    }
    const errorCode = body?.data?.error_code ?? body?.error_code
    if (errorCode === 7 || errorCode === 2046) {
      pending.delete(dir)
      return { status: 'failed', message: '汽水音乐要求安全验证，请刷新二维码重试' }
    }
    switch (body?.data?.status) {
      case 'new': return { status: 'waiting' }
      case 'scanned': return { status: 'scanned' }
      case 'expired':
        pending.delete(dir)
        return { status: 'expired' }
      default:
        pending.delete(dir)
        return { status: 'failed', message: '汽水音乐无法完成扫码，请刷新二维码重试' }
    }
  } finally {
    ticket.checking = false
  }
}

export function completeQishuiLogin(dir: string, key: string | null) {
  const ticket = pending.get(dir)
  if (!ticket?.account || !ticket.session || ticket.key !== key || ticket.expires <= Date.now()) return { loggedIn: false }
  const { session, account } = ticket
  mkdirSync(dir, { recursive: true })
  const file = sessionFile(dir)
  const temporary = `${file}.${ticket.key}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({ session, nickname: account.nickname }), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
  pending.delete(dir)
  return account
}

function readSession(dir: string): { session: string; nickname: string } | null {
  try {
    const { session, nickname } = JSON.parse(readFileSync(sessionFile(dir), 'utf8'))
    if (typeof session !== 'string' || !sessionPattern.test(session)) return null
    return { session, nickname: typeof nickname === 'string' ? nickname : '' }
  } catch {
    return null
  }
}

export async function qishuiLoginStatus(dir: string) {
  const saved = readSession(dir)
  if (!saved) return { loggedIn: false }
  const account = await profile(saved.session).catch(() => ({ loggedIn: true, nickname: saved.nickname }))
  if (readSession(dir)?.session !== saved.session) return { loggedIn: false }
  if (!account.loggedIn) rmSync(sessionFile(dir), { force: true })
  return account
}

/** 未登录或会话失效返回 null；读取期间账号已切换时丢弃结果。 */
export async function fetchQishuiUserPlaylists(dir: string) {
  const saved = readSession(dir)
  if (!saved) return null
  const { body } = await request('/luna/pc/me/playlist', accountParams, { headers: {
    'User-Agent': accountUserAgent, Cookie: `sessionid=${saved.session}`,
  } })
  if (readSession(dir)?.session !== saved.session) return []
  if (body.status_code === expiredCode) return null
  if (!Array.isArray(body.playlists)) throw new Error('汽水音乐未返回账号歌单')
  return mapQishuiPlaylists(body.playlists)
}

/** 公开接口读不到的私有歌单，用账号会话再读一次；未登录返回 null。 */
export async function fetchQishuiAccountPlaylist(dir: string, id: string) {
  const saved = readSession(dir)
  if (!saved) return null
  const detail = await fetchQishuiPlaylist(id, (url, init) => fetch(url, {
    ...init, redirect: 'error',
    headers: { ...init.headers, Cookie: `sessionid=${saved.session}` },
  }))
  return readSession(dir)?.session === saved.session ? detail : null
}

export function cancelQishuiLogin(dir: string, key: string | null) {
  if (pending.get(dir)?.key === key) pending.delete(dir)
  return { ok: true }
}

export function logoutQishui(dir: string) {
  pending.delete(dir)
  rmSync(sessionFile(dir), { force: true })
  return { ok: true }
}
