import { app, net, protocol, type BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { LyricModManager } from './manager'
import { MOD_ID, safeModPath } from './package'
import { foliumRuntime } from './runtime'

export const MOD_SCHEME = 'simplemusic-mod'
let manager: LyricModManager | undefined
export function lyricModManager(): LyricModManager {
  // net.fetch 走 Chromium 网络栈，遵循系统代理；Node 自带 fetch 不读系统代理。
  return manager ??= new LyricModManager(join(app.getPath('userData'), 'lyric-mods'), net.fetch as unknown as typeof fetch)
}

export function registerLyricModScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MOD_SCHEME, privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } }])
}

export function attachLyricModFrameGuard(win: BrowserWindow): void {
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return
    // No third-party links or redirects are handed to the system browser.
    try {
      const url = new URL(event.url)
      const previous = event.frame?.url ?? ''
      // 只放行主窗口直接子框架的首次加载；模组里再嵌套的框架一律拒绝（CSP 也禁止）。
      if (event.frame?.parent === win.webContents.mainFrame
        && (!previous || previous === 'about:blank') && url.protocol === MOD_SCHEME + ':' && MOD_ID.test(url.hostname) && url.pathname === '/__host.html'
        && /^[a-f0-9-]{36}$/.test(url.searchParams.get('session') ?? '')) return
    } catch { /* Reject every other subframe destination. */ }
    event.preventDefault()
  })
}

export async function lyricModResponse(request: Request, store: LyricModManager): Promise<Response> {
  const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }
  try {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.protocol !== MOD_SCHEME + ':' || !MOD_ID.test(url.hostname)
      || url.username || url.password || url.port) return new Response('', { status: 403 })
    const mod = await store.load(url.hostname)
    const path = decodeURIComponent(url.pathname.slice(1))
    if (path === '__host.html') {
      const session = url.searchParams.get('session') ?? ''
      if (!/^[a-f0-9-]{36}$/.test(session)) return new Response('', { status: 403 })
      const nonce = randomBytes(18).toString('base64')
      const origin = MOD_SCHEME + '://' + url.hostname
      headers['Content-Type'] = 'text/html; charset=utf-8'
      // Pixi's signed 52Hz bundle generates local shader bindings with Function.
      // This permission belongs only to its opaque sandbox, never the app page.
      const shaderEval = mod.info.id === 'visualizer52hz' ? " 'unsafe-eval'" : ''
      headers['Content-Security-Policy'] = "default-src 'none'; script-src 'nonce-" + nonce + "' " + origin + shaderEval
        + "; style-src 'unsafe-inline' " + origin + "; img-src data: blob: " + origin
        + "; font-src data: " + origin + "; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
      const config = JSON.stringify({ id: mod.info.id, client: origin + '/' + mod.client, session }).replace(/</g, '\\u003c')
      const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        + '<style>html{color-scheme:dark}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}#stage{position:absolute;inset:0;overflow:hidden}#subtitle{position:absolute;bottom:12px;left:6%;right:6%;font:500 16px/1.5 system-ui;text-align:center;pointer-events:none}*{box-sizing:border-box}</style>'
        + '<div id="stage"></div><div id="subtitle"></div><script nonce="' + nonce + '">(' + foliumRuntime.toString() + ')(' + config + ')</script></html>'
      return new Response(html, { headers })
    }
    if (!safeModPath(path)) return new Response('', { status: 403 })
    const types: Record<string, string> = { js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2' }
    const type = types[path.split('.').at(-1)!]
    const bytes = mod.files.get(path)
    // Arbitrary package HTML/SVG is never served as an executable document.
    if (!bytes || !type) return new Response('', { status: 404 })
    headers['Content-Type'] = type
    return new Response(new Uint8Array(bytes), { headers })
  } catch { return new Response('', { status: 404 }) }
}

export function handleLyricModProtocol(): void {
  protocol.handle(MOD_SCHEME, request => lyricModResponse(request, lyricModManager()))
}
