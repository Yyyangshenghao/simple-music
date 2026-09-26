import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

const APPLE_MUSIC_URL = 'https://music.apple.com/'
const START_TIMEOUT_MS = 30_000
const COMMAND_TIMEOUT_MS = 15_000

interface CdpTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

interface CdpResult {
  id?: number
  result?: Record<string, unknown>
  error?: { message?: string }
}

interface RuntimeEvaluateResult {
  result?: { value?: unknown; description?: string }
  exceptionDetails?: { text?: string; exception?: { description?: string } }
}

/**
 * 开发环境使用系统 Chrome 的正式 Widevine 客户端承载 Apple Music。
 * CastLabs 自带的开发 VMP 签名会被 Apple 生产许可证服务拒绝；发布包仍走
 * 应用内 CastLabs + EVS 生产签名，这个后端只解决本地开发和真实账号验收。
 */
export class AppleMusicChromePage {
  private child?: ChildProcess
  private socket?: WebSocket
  private targetId = ''
  private commandId = 0
  private closed = false
  private pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()

  private constructor(private readonly onClose: () => void) {}

  static async open(userDataDir: string, onClose: () => void): Promise<AppleMusicChromePage> {
    const executable = resolveChromeExecutable()
    if (!executable) throw new Error('本地 Apple Music DRM 验证需要安装 Google Chrome')
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const page = new AppleMusicChromePage(onClose)
      try {
        await page.launch(executable, join(userDataDir, 'apple-music-browser'))
        return page
      } catch (error) {
        lastError = error
        await page.close()
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Chrome Apple Music 启动失败')
  }

  isAlive(): boolean {
    return !this.closed && !!this.socket && this.socket.readyState === WebSocket.OPEN
  }

  async evaluate(expression: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<unknown> {
    const response = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs) as RuntimeEvaluateResult
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Chrome 页面脚本执行失败')
    }
    return response.result?.value
  }

  async show(): Promise<void> {
    await this.setWindowState('normal')
    await this.call('Page.bringToFront')
  }

  async minimize(): Promise<void> {
    await this.setWindowState('minimized')
  }

  async navigate(url: string): Promise<void> {
    await this.call('Page.navigate', { url })
  }

  async unauthorize(): Promise<void> {
    await this.evaluate(`(async () => {
      const music = globalThis.MusicKit?.getInstance?.()
      if (music?.isAuthorized) await music.unauthorize()
    })()`)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try { await this.call('Browser.close', {}, 2_000) } catch {}
    this.rejectPending(new Error('Chrome Apple Music 会话已关闭'))
    this.socket?.close()
    this.socket = undefined
    if (this.child && !this.child.killed) this.child.kill()
    this.child = undefined
  }

  private async launch(executable: string, profileDir: string): Promise<void> {
    const port = await reservePort()
    const child = spawn(executable, [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--no-first-run',
      '--no-default-browser-check',
      `--app=${APPLE_MUSIC_URL}`,
    ], { stdio: 'ignore' })
    this.child = child
    child.once('exit', () => this.handleClosed())
    child.once('error', () => this.handleClosed())

    const target = await waitForTarget(port, () => this.closed)
    if (!target.webSocketDebuggerUrl) throw new Error('无法连接 Chrome Apple Music 页面')
    this.targetId = target.id
    await this.connect(target.webSocketDebuggerUrl)
    await this.call('Runtime.enable')
  }

  private connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      this.socket = socket
      const timer = setTimeout(() => reject(new Error('连接 Chrome Apple Music 页面超时')), COMMAND_TIMEOUT_MS)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接 Chrome Apple Music 页面')) }, { once: true })
      socket.addEventListener('close', () => this.handleClosed())
      socket.addEventListener('message', event => this.handleMessage(String(event.data)))
    })
  }

  private call(method: string, params: Record<string, unknown> = {}, timeoutMs = COMMAND_TIMEOUT_MS): Promise<Record<string, unknown>> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Chrome Apple Music 页面未连接'))
    const id = ++this.commandId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Chrome Apple Music 操作超时'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  private handleMessage(raw: string): void {
    let message: CdpResult
    try { message = JSON.parse(raw) as CdpResult } catch { return }
    if (!message.id) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(message.error.message || 'Chrome 调试命令失败'))
    else pending.resolve(message.result ?? {})
  }

  private async setWindowState(windowState: 'normal' | 'minimized'): Promise<void> {
    const result = await this.call('Browser.getWindowForTarget', { targetId: this.targetId })
    const windowId = result.windowId
    if (typeof windowId !== 'number') return
    await this.call('Browser.setWindowBounds', { windowId, bounds: { windowState } })
  }

  private handleClosed(): void {
    if (this.closed) return
    this.closed = true
    this.rejectPending(new Error('Chrome Apple Music 页面已关闭'))
    this.onClose()
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

export function resolveChromeExecutable(): string | null {
  const configured = process.env.SIMPLEMUSIC_CHROME_PATH
  const candidates = [
    configured,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined,
    process.platform === 'darwin' ? join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome') : undefined,
    process.platform === 'win32' ? join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe') : undefined,
    process.platform === 'win32' ? join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe') : undefined,
    process.platform === 'win32' ? join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe') : undefined,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : undefined,
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : undefined,
  ].filter((value): value is string => !!value)
  return candidates.find(existsSync) ?? null
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForTarget(port: number, cancelled: () => boolean): Promise<CdpTarget> {
  const deadline = Date.now() + START_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline && !cancelled()) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json() as CdpTarget[]
      const target = targets.find(item => item.type === 'page' && item.url.startsWith('https://music.apple.com'))
      if (target) return target
    } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  if (cancelled()) throw new Error('连接已取消')
  throw new Error(lastError instanceof Error ? `Chrome Apple Music 启动失败：${lastError.message}` : 'Chrome Apple Music 启动超时')
}
