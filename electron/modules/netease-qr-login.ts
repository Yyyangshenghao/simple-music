import { BrowserWindow, session } from 'electron'
import { NETEASE_PARTITION, neteaseCookieHasLogin, readNeteaseCookie } from './login-manager'
import type { OkResult, QrLoginPoll } from '../../src/types/ipc'

/**
 * 网易云应用内扫码：直接调扫码接口会被 App 判成「设备环境异常」（缺网页端反爬指纹），
 * 所以在网易登录分区里开一个隐藏的官方网页，让它自己生成二维码，再把 canvas 取出来显示在应用浮层里。
 * 扫码成功的判定与网页登录窗一致：分区里出现 MUSIC_U。
 */

const HOME_URL = 'https://music.163.com/'
const IDLE_TIMEOUT_MS = 30_000
const MAX_LIFETIME_MS = 6 * 60_000

let win: BrowserWindow | null = null
let idleTimer: NodeJS.Timeout | null = null
let lifeTimer: NodeJS.Timeout | null = null

function destroy(): void {
  if (idleTimer) clearTimeout(idleTimer)
  if (lifeTimer) clearTimeout(lifeTimer)
  idleTimer = lifeTimer = null
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}

// 浮层关掉或渲染层崩溃后不再轮询：隐藏页面自动回收。
function touch(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(destroy, IDLE_TIMEOUT_MS)
}

/** 在页面里取二维码 canvas 与登录弹窗文字；页面结构变化时返回空图。 */
const GRAB_SCRIPT = `(() => {
  const canvas = [...document.querySelectorAll('canvas')].find((c) => c.width >= 150 && c.width === c.height && c.offsetParent !== null)
  // 扫码后官方页会把二维码换成确认面板：记住首次找到的弹窗容器，之后从它读状态文字。
  if (canvas) window.__smQrBox = canvas.closest('div[class]')?.parentElement?.parentElement || window.__smQrBox
  const box = window.__smQrBox && window.__smQrBox.isConnected ? window.__smQrBox : null
  let image = ''
  try { image = canvas ? canvas.toDataURL('image/png') : '' } catch {}
  return { image, text: box ? String(box.innerText || '').slice(0, 200) : '' }
})()`

const OPEN_LOGIN_SCRIPT = `(() => {
  const link = [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === '登录')
  if (link) link.click()
  return !!link
})()`

async function confirmedCookie(): Promise<string> {
  const cookie = await readNeteaseCookie(session.fromPartition(NETEASE_PARTITION))
  return neteaseCookieHasLogin(cookie) ? cookie : ''
}

async function grab(): Promise<{ image: string; text: string }> {
  if (!win || win.isDestroyed()) return { image: '', text: '' }
  return win.webContents.executeJavaScript(GRAB_SCRIPT, true).catch(() => ({ image: '', text: '' }))
}

export async function startNeteaseQr(): Promise<QrLoginPoll> {
  destroy()
  const reused = await confirmedCookie()
  if (reused) return { status: 'confirmed', cookie: reused }
  win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    webPreferences: { partition: NETEASE_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const page = win
  page.webContents.setAudioMuted(true)
  // 隐藏页面只用来出码：不弹新窗口，不离开网易域。
  page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  page.webContents.on('will-navigate', (event, url) => {
    if (!/^https:\/\/([a-z0-9-]+\.)*(163|126)\.(com|net)\//i.test(url)) event.preventDefault()
  })
  lifeTimer = setTimeout(destroy, MAX_LIFETIME_MS)
  touch()
  try {
    await page.loadURL(HOME_URL)
    // 首页脚本挂好登录入口前点击无效，最多等 8 秒。
    for (let i = 0; i < 16 && win === page; i++) {
      if (await page.webContents.executeJavaScript(OPEN_LOGIN_SCRIPT, true).catch(() => false)) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    for (let i = 0; i < 20 && win === page; i++) {
      const { image } = await grab()
      if (image) return { status: 'waiting', image }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  } catch (err) {
    console.warn('[NeteaseQr] load failed:', (err as Error).message)
  }
  if (win === page) destroy()
  return { status: 'failed', message: '网易云登录页加载失败，请检查网络' }
}

export async function pollNeteaseQr(): Promise<QrLoginPoll> {
  const cookie = await confirmedCookie()
  if (cookie) {
    destroy()
    return { status: 'confirmed', cookie }
  }
  if (!win || win.isDestroyed()) return { status: 'expired' }
  touch()
  const { image, text } = await grab()
  if (/失效|过期/.test(text)) return { status: 'expired' }
  if (/扫描成功|扫码成功|确认登录/.test(text)) return { status: 'scanned', image: image || undefined }
  return { status: 'waiting', image: image || undefined }
}

export function cancelNeteaseQr(): OkResult {
  destroy()
  return { ok: true }
}
