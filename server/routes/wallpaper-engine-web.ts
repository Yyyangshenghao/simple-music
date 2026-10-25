import { createReadStream, existsSync, promises as fsp, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { RouteHandler } from '../types'
import { sendError } from '../lib/http'
import { isAllowedToken } from '../lib/security'
import {
  getWallpaperEngineProject,
  resolveWallpaperSceneFile,
  resolveWallpaperWebFile,
  wallpaperContentType
} from '../lib/wallpaper-engine'

/**
 * 网页型 Wallpaper Engine 壁纸需要一个能加载同目录 JS/CSS/贴图的整页环境，
 * 场景型还需要一个能执行壁纸自带 SceneScript 的容器，因此两者都用 iframe
 * 直接访问本路由，而不是塞进 <video> 或主渲染层。
 *
 * 这些路由挂在 `/api` 之外：iframe 的子资源请求带不上 query token，
 * 只能把 token 放在路径段里、由路由自己校验。除 token 外，只允许读取
 * 该壁纸工程目录内的文件（resolve* 负责挡 ../ 越界）。
 *
 * `/we-scene/<token>/host` 是场景遥控页：它从同源的 `/we-wallpaper` 取工程资源，
 * 把壁纸脚本关在 127.0.0.1 这个独立源里，再通过 postMessage 接受主界面的
 * 暂停/恢复、帧率与音频频谱。主界面与它跨源，拿不到彼此的 DOM。
 */

const WEB_PREFIX = '/we-wallpaper/'
const SCENE_PREFIX = '/we-scene/'

/** 背景壁纸不该盖过正在播放的音乐：把壁纸里媒体元素的首次播放强制静音。 */
const MUTE_MEDIA = `<script>(function(){var play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){try{this.muted=true}catch(e){}return play.apply(this,arguments)}})()</script>`

const SCENE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'"

/** 场景渲染器是 WebWallGL 的 UMD 构建（自包含，暴露 window.WebWallGL）。 */
const SCENE_HOST = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}#wp{position:fixed;inset:0}</style>
<script src="./engine.js" onerror="window.__smEngineFailed=true"></script>
</head>
<body>
<div id="wp"></div>
<script>
(function () {
  'use strict'
  var parts = location.pathname.split('/')
  var token = parts[2] || '-'
  var params = new URLSearchParams(location.search)
  var id = params.get('id') || ''
  var fps = Math.max(10, Math.min(60, Number(params.get('fps')) || 30))
  var dpr = Math.max(0.5, Math.min(2, Number(params.get('dpr')) || 1))
  var scripts = params.get('scripts') !== '0'
  // 「均衡」不传显式档位，交给 autoQuality 按实测帧率降级。
  var QUALITY = {
    smooth: { antiAliasing: 'off', particles: 'low', postProcessing: 'low' },
    detailed: { antiAliasing: 'fxaa' }
  }
  var quality = QUALITY[params.get('quality') || ''] || undefined
  var spectrum = { left: new Float32Array(64), right: new Float32Array(64) }
  var audio = { snapshot: function () { return spectrum } }
  var failed = false
  function send(type, payload) {
    var msg = { source: 'sm-we-scene', type: type }
    if (payload) for (var key in payload) msg[key] = payload[key]
    try { parent.postMessage(msg, '*') } catch (e) {}
  }
  function fail(message) {
    if (failed) return
    failed = true
    send('error', { message: String(message || 'WALLPAPER_SCENE_FAILED') })
  }
  if (window.__smEngineFailed || typeof WebWallGL === 'undefined') {
    fail('WALLPAPER_SCENE_ENGINE_MISSING')
    return
  }
  WebWallGL.mount(document.getElementById('wp'), {
    source: WebWallGL.httpSource('/we-wallpaper/' + encodeURIComponent(token) + '/' + encodeURIComponent(id) + '/'),
    fps: fps,
    renderDpr: dpr,
    volume: 0,
    scripts: scripts,
    quality: quality,
    audio: audio,
    media: null,
    autoQuality: true,
    mountTimeoutMs: 45000,
    onReady: function (info) {
      send('ready', { width: info && info.width, height: info && info.height, layers: info && info.layerCount })
    },
    onError: function (error) { fail(error && error.message || error) }
  }).then(function (scene) {
    window.__smScene = scene
    window.addEventListener('message', function (event) {
      var data = event.data
      if (!data || data.source !== 'sm-we-scene-host') return
      try {
        if (data.type === 'pause') scene.pause()
        else if (data.type === 'resume') scene.resume()
        else if (data.type === 'fps' && data.fps) scene.setFps(Math.max(10, Math.min(60, Number(data.fps) || 30)))
        else if (data.type === 'pointer') scene.pushPointer(data.u, data.v, data.buttons || 0)
        else if (data.type === 'spectrum' && data.left && data.right) {
          spectrum.left.set(data.left)
          spectrum.right.set(data.right)
        }
      } catch (e) {}
    })
    send('mounted')
  }).catch(function (error) { fail(error && error.message || error) })
})()
</script>
</body>
</html>`

/** 解析 npm 包里的 UMD 构建；未安装时返回 null，场景壁纸回退为封面。 */
let engineScriptPath: string | null | undefined
function sceneEnginePath(): string | null {
  if (engineScriptPath !== undefined) return engineScriptPath
  try {
    const require = createRequire(import.meta.url)
    const pkg = require.resolve('webwallgl/package.json')
    const file = join(dirname(pkg), 'webwallgl.global.min.js')
    engineScriptPath = existsSync(file) ? file : null
  } catch {
    engineScriptPath = null
  }
  return engineScriptPath
}

function injectMute(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (tag) => tag + MUTE_MEDIA)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => tag + MUTE_MEDIA)
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)
  return doctype ? html.replace(doctype[0], doctype[0] + MUTE_MEDIA) : MUTE_MEDIA + html
}

function tokenFromSegment(segment: string): string | null | undefined {
  if (segment === '-') return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

function serveEngine(res: Parameters<RouteHandler>[1]): boolean {
  const file = sceneEnginePath()
  if (!file) return false
  try {
    const stat = statSync(file)
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': String(stat.size),
      // token 每次启动都变，URL 自然带上版本；同一个进程里不必反复读 1MB 脚本。
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    })
    createReadStream(file).pipe(res)
  } catch {
    return false
  }
  return true
}

/** `/we-scene/<token>/host` 与 `/we-scene/<token>/engine.js`。 */
async function serveScene(req: Parameters<RouteHandler>[0], res: Parameters<RouteHandler>[1], url: URL, ctx: Parameters<RouteHandler>[3]): Promise<boolean> {
  const [tokenSegment = '', action = ''] = url.pathname.slice(SCENE_PREFIX.length).split('/')
  const provided = tokenFromSegment(tokenSegment)
  if (provided === undefined) {
    sendError(res, 400, 'Invalid token')
    return true
  }
  if (!isAllowedToken(ctx.wallpaperWebToken, provided)) {
    sendError(res, 403, 'Invalid token')
    return true
  }
  if (req.method !== 'GET') {
    sendError(res, 405, 'Method Not Allowed')
    return true
  }
  if (action === 'host') {
    const body = Buffer.from(SCENE_HOST, 'utf8')
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': SCENE_CSP,
      'X-Content-Type-Options': 'nosniff'
    })
    res.end(body)
    return true
  }
  if (action === 'engine.js') {
    if (serveEngine(res)) return true
    sendError(res, 404, 'WALLPAPER_SCENE_ENGINE_MISSING')
    return true
  }
  sendError(res, 404, 'Not Found')
  return true
}

export const wallpaperEngineWebRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (url.pathname.startsWith(SCENE_PREFIX)) return serveScene(req, res, url, ctx)
  if (!url.pathname.startsWith(WEB_PREFIX)) return false
  if (req.method !== 'GET') {
    sendError(res, 405, 'Method Not Allowed')
    return true
  }
  const [tokenSegment = '', rawId = '', ...rest] = url.pathname.slice(WEB_PREFIX.length).split('/')
  const provided = tokenFromSegment(tokenSegment)
  if (provided === undefined) {
    sendError(res, 400, 'Invalid token')
    return true
  }
  // 独立 server / 纯前端调试时 token 缺省，isAllowedToken 一律放行。
  if (!isAllowedToken(ctx.wallpaperWebToken, provided)) {
    sendError(res, 403, 'Invalid token')
    return true
  }
  let id: string
  let relativePath: string
  try {
    id = decodeURIComponent(rawId)
    relativePath = rest.map(decodeURIComponent).join('/')
  } catch {
    sendError(res, 400, 'Invalid path')
    return true
  }
  const project = await getWallpaperEngineProject(ctx.userDataDir, id)
  // 场景型的整页由 /we-scene 的遥控页负责，这里只提供它需要的工程资源。
  const file = !project ? null
    : project.type === 'scene' ? resolveWallpaperSceneFile(project, relativePath)
      : resolveWallpaperWebFile(project, relativePath)
  if (!project || !file) {
    sendError(res, 404, 'WALLPAPER_MISSING')
    return true
  }

  const contentType = wallpaperContentType(file)
  try {
    if (contentType.startsWith('text/html')) {
      const html = injectMute(await fsp.readFile(file, 'utf8'))
      const body = Buffer.from(html, 'utf8')
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      })
      res.end(body)
      return true
    }
    const stat = await fsp.stat(file)
    if (!stat.isFile()) {
      sendError(res, 404, 'WALLPAPER_MISSING')
      return true
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    createReadStream(file).pipe(res)
  } catch {
    if (!res.headersSent) sendError(res, 404, 'WALLPAPER_MISSING')
    else res.end()
  }
  return true
}
