import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: h.spawn }))
vi.mock('node:fs', () => ({ existsSync: () => true }))
vi.mock('node:net', () => ({ createServer: () => ({
  once: vi.fn(), listen(_port: number, _host: string, ready: () => void) { ready() },
  address: () => ({ port: 9222 }), close(done: () => void) { done() },
}) }))

import { AppleMusicChromePage } from './apple-music-chrome-page'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function setup(ignoreTerm = false, ignoreBrowserClose = false) {
  const child = Object.assign(new EventEmitter(), { pid: 1234, exitCode: null, signalCode: null as string | null, killed: false, kill: vi.fn() })
  child.kill.mockImplementation((signal: string) => {
    child.killed = true
    if (ignoreTerm && signal === 'SIGTERM') return true
    child.signalCode = signal
    child.emit('exit')
    return true
  })
  h.spawn.mockReturnValue(child)
  let socket!: TestSocket
  class TestSocket extends EventTarget {
    static OPEN = 1
    readyState = 1
    close = vi.fn(() => { this.readyState = 3; this.dispatchEvent(new Event('close')) })
    constructor() {
      super()
      socket = this
      queueMicrotask(() => this.dispatchEvent(new Event('open')))
    }
    send(raw: string) {
      const { id, method } = JSON.parse(raw)
      if (ignoreBrowserClose && method === 'Browser.close') return
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result: {} }) })))
    }
  }
  vi.stubGlobal('WebSocket', TestSocket)
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => [{ id: 'apple', type: 'page', url: 'https://music.apple.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/test' }] })))
  return { child, socket: () => socket }
}

it('调试连接断开时终止专用 Chrome，避免残留进程占用登录目录', async () => {
  const { child, socket } = setup()
  const onClose = vi.fn()
  const page = await AppleMusicChromePage.open('/tmp/apple-test', onClose)
  expect(page.isAlive()).toBe(true)
  socket().dispatchEvent(new Event('close'))
  expect(page.isAlive()).toBe(false)
  await page.close()
  expect(child.kill).toHaveBeenCalledOnce()
  expect(socket().close).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledOnce()
  await page.close()
  expect(child.kill).toHaveBeenCalledOnce()
})

it('退出等待进程结束，SIGTERM 无效时升级 SIGKILL，重复关闭共享清理', async () => {
  vi.useFakeTimers()
  const { child } = setup(true, true)
  const opening = AppleMusicChromePage.open('/tmp/apple-test', vi.fn())
  await vi.advanceTimersByTimeAsync(0)
  const page = await opening
  const closing = page.close()
  expect(page.close()).toBe(closing)
  let done = false
  void closing.then(() => { done = true })
  await vi.advanceTimersByTimeAsync(2000)
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  expect(done).toBe(false)
  await vi.advanceTimersByTimeAsync(1500)
  await closing
  expect(child.kill).toHaveBeenLastCalledWith('SIGKILL')
  expect(done).toBe(true)
})

it('Chrome 正在启动时取消也会等待清理，不再重试创建进程', async () => {
  vi.useFakeTimers()
  const { child } = setup()
  h.spawn.mockClear()
  vi.stubGlobal('fetch', vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })))
  const controller = new AbortController()
  const opening = AppleMusicChromePage.open('/tmp/apple-test', vi.fn(), controller.signal)
  const rejected = expect(opening).rejects.toThrow('连接已取消')
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  await vi.advanceTimersByTimeAsync(200)
  await rejected
  expect(child.kill).toHaveBeenCalledOnce()
  expect(h.spawn).toHaveBeenCalledOnce()
})
