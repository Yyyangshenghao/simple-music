import { Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerContext } from '../types'
import { clearWallpaperEngineCache, setWallpaperEngineRoot } from '../lib/wallpaper-engine'
import { wallpaperEngineWebRoutes } from './wallpaper-engine-web'

const TOKEN = 'test-wallpaper-token'
const dirs: string[] = []
let ctx: ServerContext

class MockResponse extends Writable {
  status = 0
  headers: Record<string, string> = {}
  chunks: Buffer[] = []

  writeHead(status: number, headers?: Record<string, string>): this {
    this.status = status
    this.headers = headers ?? {}
    return this
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }

  body(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sm-we-route-'))
  dirs.push(dir)
  return dir
}

async function writeProject(contentDir: string, id: string, project: unknown, files: Record<string, string> = {}): Promise<void> {
  const dir = join(contentDir, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'project.json'), JSON.stringify(project))
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true })
    await writeFile(join(dir, name), content)
  }
}

async function run(path: string, method = 'GET'): Promise<MockResponse> {
  const req = { method } as IncomingMessage
  const res = new MockResponse()
  const handled = await wallpaperEngineWebRoutes(req, res as unknown as ServerResponse, new URL(path, 'http://127.0.0.1'), ctx)
  expect(handled).toBe(true)
  // 文件响应是 createReadStream().pipe(res)，等流写完再断言。
  if (!res.writableFinished) await new Promise<void>(resolve => res.once('finish', () => resolve()))
  return res
}

beforeEach(async () => {
  clearWallpaperEngineCache()
  const root = await tempDir()
  const content = join(root, 'steamapps', 'workshop', 'content', '431960')
  await mkdir(content, { recursive: true })
  await writeProject(content, '222', { type: 'web', file: 'index.html', title: '网页壁纸' }, {
    'index.html': '<html><head></head><body>web</body></html>',
    'assets/style.css': 'body{}'
  })
  await writeProject(content, '333', { type: 'scene', file: 'scene.pkg', title: '场景壁纸', preview: 'preview.png' }, {
    'scene.pkg': 'pkg-body',
    'preview.png': 'image',
    'shaders/effects/water.json': '{}'
  })
  await writeProject(content, '111', { type: 'video', file: 'wallpaper.mp4', title: '视频壁纸' }, {
    'wallpaper.mp4': 'video'
  })
  const userDataDir = await tempDir()
  await setWallpaperEngineRoot(userDataDir, root)
  ctx = { userDataDir, port: 1234, wallpaperWebToken: TOKEN } as ServerContext
})

afterEach(async () => {
  clearWallpaperEngineCache()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('场景壁纸遥控页', () => {
  it('返回带 CSP 的遥控页，资源仍走同源的 /we-wallpaper', async () => {
    const res = await run(`/we-scene/${TOKEN}/host`)
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toContain('text/html')
    expect(res.headers['Content-Security-Policy']).toContain("'unsafe-eval'")
    const html = res.body().toString('utf8')
    expect(html).toContain('WebWallGL.mount')
    expect(html).toContain('/we-wallpaper/')
    expect(html).toContain("source: 'sm-we-scene'")
    // 挂载时读取画质与脚本开关；帧率可在就绪后通过 postMessage 热调。
    expect(html).toContain("params.get('quality')")
    expect(html).toContain("params.get('scripts')")
    expect(html).toContain('quality: quality')
  })

  it('引擎脚本可直接加载，token 不对时拒绝', async () => {
    const ok = await run(`/we-scene/${TOKEN}/engine.js`)
    expect(ok.status).toBe(200)
    expect(ok.headers['Content-Type']).toContain('text/javascript')
    expect(ok.body().toString('utf8', 0, 20)).toContain('function')
    expect(Number(ok.headers['Content-Length'])).toBeGreaterThan(100_000)

    expect((await run('/we-scene/wrong/host')).status).toBe(403)
    expect((await run(`/we-scene/-/host`)).status).toBe(403)
    expect((await run(`/we-scene/${TOKEN}/missing`)).status).toBe(404)
  })
})

describe('壁纸工程资源路由', () => {
  it('场景工程按相对路径提供 scene.pkg 与 shader，且没有目录入口', async () => {
    const pkg = await run(`/we-wallpaper/${TOKEN}/333/scene.pkg`)
    expect(pkg.status).toBe(200)
    expect(pkg.body().toString()).toBe('pkg-body')

    const shader = await run(`/we-wallpaper/${TOKEN}/333/shaders/effects/water.json`)
    expect(shader.status).toBe(200)
    expect(shader.body().toString()).toBe('{}')

    expect((await run(`/we-wallpaper/${TOKEN}/333/`)).status).toBe(404)
  })

  it('场景资源不能越出工程目录，视频工程也不走这条路由', async () => {
    expect((await run(`/we-wallpaper/${TOKEN}/333/..%2F111%2Fwallpaper.mp4`)).status).toBe(404)
    expect((await run(`/we-wallpaper/${TOKEN}/333/..%2F..%2Fproject.json`)).status).toBe(404)
    expect((await run(`/we-wallpaper/${TOKEN}/111/wallpaper.mp4`)).status).toBe(404)
  })

  it('网页壁纸仍返回入口页并注入静音脚本', async () => {
    const index = await run(`/we-wallpaper/${TOKEN}/222/`)
    expect(index.status).toBe(200)
    expect(index.body().toString()).toContain('HTMLMediaElement.prototype.play')

    const css = await run(`/we-wallpaper/${TOKEN}/222/assets/style.css`)
    expect(css.status).toBe(200)
    expect(css.headers['Content-Type']).toContain('text/css')
  })
})
