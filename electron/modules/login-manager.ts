import { BrowserWindow, session, shell, type Session, type Cookie } from 'electron'
import type { LoginResult, OkResult } from '../../src/types/ipc'

const NETEASE_LOGIN_PARTITION = 'persist:mineradio-netease-login'
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login'
const QQ_LOGIN_PARTITION = 'persist:mineradio-qqmusic-login'
const QQ_LOGIN_URL = 'https://y.qq.com/n/ryqq/profile'

const QQ_COOKIE_PRIORITY = [
  'uin', 'qqmusic_uin', 'wxuin', 'login_type', 'qm_keyst', 'qqmusic_key', 'p_skey', 'skey',
  'psrf_qqopenid', 'psrf_qqunionid', 'psrf_qqaccess_token', 'psrf_qqrefresh_token',
  'wxopenid', 'wxunionid', 'wxrefresh_token', 'wxskey', 'p_uin', 'ptcz', 'RK'
]
const NETEASE_COOKIE_PRIORITY = [
  'MUSIC_U', '__csrf', 'NMTID', 'MUSIC_A', '__remember_me',
  '_ntes_nuid', '_ntes_nnid', 'WEVNSM', 'WNMCID', 'JSESSIONID-WYYY'
]

function parseCookieHeader(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(text || '').split(';')) {
    const raw = part.trim()
    const idx = raw.indexOf('=')
    if (idx <= 0) continue
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim()
  }
  return out
}

function qqCookieHasLogin(text: string): boolean {
  const o = parseCookieHeader(text)
  const rawUin = Number(o.login_type) === 2 ? o.wxuin || o.uin || o.p_uin || '' : o.uin || o.qqmusic_uin || o.wxuin || o.p_uin || ''
  const uin = String(rawUin).replace(/\D/g, '')
  const key = o.qm_keyst || o.qqmusic_key || o.music_key || o.p_skey || o.skey || o.psrf_qqaccess_token || o.psrf_qqrefresh_token || o.wxrefresh_token || o.wxskey || ''
  return !!(uin && key)
}

function qqCookieHasPlaybackLogin(text: string): boolean {
  const o = parseCookieHeader(text)
  const rawUin = Number(o.login_type) === 2 ? o.wxuin || o.uin || o.p_uin || '' : o.uin || o.qqmusic_uin || o.wxuin || o.p_uin || ''
  const uin = String(rawUin).replace(/\D/g, '')
  const key = o.qm_keyst || o.qqmusic_key || o.music_key || o.wxskey || ''
  return !!(uin && key)
}

function neteaseCookieHasLogin(text: string): boolean {
  return !!parseCookieHeader(text).MUSIC_U
}

function isQQCookieDomain(domain: string): boolean {
  const d = String(domain || '').replace(/^\./, '').toLowerCase()
  return d === 'qq.com' || d.endsWith('.qq.com') || d.endsWith('qqmusic.qq.com')
}

function isNeteaseCookieDomain(domain: string): boolean {
  const d = String(domain || '').replace(/^\./, '').toLowerCase()
  return (
    d === '163.com' || d.endsWith('.163.com') ||
    d === 'netease.com' || d.endsWith('.netease.com')
  )
}

function buildCookieHeaderFor(cookies: Cookie[], allowed: (domain: string) => boolean, priority: string[]): string {
  const picked = new Map<string, string>()
  for (const c of cookies) {
    if (!c?.name || !allowed(c.domain ?? '')) continue
    picked.set(c.name, c.value ?? '')
  }
  const ordered: Array<[string, string]> = []
  for (const name of priority) {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name) ?? ''])
      picked.delete(name)
    }
  }
  picked.forEach((value, name) => ordered.push([name, value]))
  return ordered
    .filter(([name, value]) => name && value !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

async function readQQCookie(s: Session): Promise<string> {
  return buildCookieHeaderFor(await s.cookies.get({}), isQQCookieDomain, QQ_COOKIE_PRIORITY)
}
async function readNeteaseCookie(s: Session): Promise<string> {
  return buildCookieHeaderFor(await s.cookies.get({}), isNeteaseCookieDomain, NETEASE_COOKIE_PRIORITY)
}

interface LoginFlowOptions {
  partition: string
  url: string
  title: string
  width: number
  height: number
  read: (s: Session) => Promise<string>
  hasLogin: (cookie: string) => boolean
  hasFullLogin: (cookie: string) => boolean
  owner: BrowserWindow | null
}

function runLoginFlow(opts: LoginFlowOptions): Promise<LoginResult> {
  const cookieSession = session.fromPartition(opts.partition)
  return (async () => {
    const initial = await opts.read(cookieSession)
    if (opts.hasFullLogin(initial)) return { ok: true, cookie: initial, reused: true }

    return new Promise<LoginResult>((resolve) => {
      let settled = false
      let pollTimer: NodeJS.Timeout | null = null
      const win = new BrowserWindow({
        width: opts.width,
        height: opts.height,
        minWidth: 760,
        minHeight: 560,
        parent: opts.owner && !opts.owner.isDestroyed() ? opts.owner : undefined,
        show: false,
        autoHideMenuBar: true,
        title: opts.title,
        backgroundColor: '#111111',
        webPreferences: { partition: opts.partition, contextIsolation: true, nodeIntegration: false, sandbox: true }
      })
      const finish = (result: LoginResult) => {
        if (settled) return
        settled = true
        if (pollTimer) clearInterval(pollTimer)
        if (!win.isDestroyed()) win.close()
        resolve(result)
      }
      const check = async () => {
        try {
          const cookie = await opts.read(cookieSession)
          if (opts.hasFullLogin(cookie)) finish({ ok: true, cookie })
        } catch (e) {
          console.warn('Login cookie check failed:', (e as Error).message)
        }
      }
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) win.loadURL(url).catch(() => {})
        else shell.openExternal(url).catch(() => {})
        return { action: 'deny' }
      })
      win.webContents.on('did-finish-load', () => void check())
      win.on('ready-to-show', () => win.show())
      win.on('closed', async () => {
        if (settled) return
        if (pollTimer) clearInterval(pollTimer)
        try {
          const cookie = await opts.read(cookieSession)
          resolve(opts.hasLogin(cookie) ? { ok: true, cookie } : { ok: false, cancelled: true, message: '登录窗口已关闭' })
        } catch (e) {
          resolve({ ok: false, error: (e as Error).message || '登录窗口已关闭' })
        }
      })
      pollTimer = setInterval(() => void check(), 1200)
      win.loadURL(opts.url).catch((e) => finish({ ok: false, error: (e as Error).message }))
    })
  })()
}

export function openNeteaseLogin(owner: BrowserWindow | null): Promise<LoginResult> {
  return runLoginFlow({
    partition: NETEASE_LOGIN_PARTITION,
    url: NETEASE_LOGIN_URL,
    title: '网易云音乐登录',
    width: 940,
    height: 760,
    read: readNeteaseCookie,
    hasLogin: neteaseCookieHasLogin,
    hasFullLogin: neteaseCookieHasLogin,
    owner
  })
}

export function openQQLogin(owner: BrowserWindow | null): Promise<LoginResult> {
  return runLoginFlow({
    partition: QQ_LOGIN_PARTITION,
    url: QQ_LOGIN_URL,
    title: 'QQ 音乐登录',
    width: 900,
    height: 720,
    read: readQQCookie,
    hasLogin: qqCookieHasLogin,
    hasFullLogin: qqCookieHasPlaybackLogin,
    owner
  })
}

async function clearSession(partition: string): Promise<OkResult> {
  await session
    .fromPartition(partition)
    .clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'] })
  return { ok: true }
}

export const clearNeteaseLogin = (): Promise<OkResult> => clearSession(NETEASE_LOGIN_PARTITION)
export const clearQQLogin = (): Promise<OkResult> => clearSession(QQ_LOGIN_PARTITION)
