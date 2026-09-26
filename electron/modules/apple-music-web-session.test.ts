import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const windows: Array<ReturnType<typeof makeWindow>> = []
  const componentReady = vi.fn(async () => {})
  const clearStorageData = vi.fn(async () => {})
  const setPermissionRequestHandler = vi.fn()
  const setPermissionCheckHandler = vi.fn()
  const chrome = {
    isAlive: vi.fn(() => true),
    evaluate: vi.fn(async (script: string, _timeoutMs?: number) => script.includes('"type":"state"') ? { ...state } : true),
    show: vi.fn(async () => {}),
    minimize: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    unauthorize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
  const openChrome = vi.fn(async () => chrome)
  let loadBehavior: undefined | (() => Promise<void>)
  let state = { connected: true, loggedIn: false, subscription: 'unknown' as 'unknown' | 'active' | 'inactive', storefront: 'cn', playbackId: '', status: 'idle', position: 0, duration: 0 }

  function makeWindow(options: Electron.BrowserWindowConstructorOptions) {
    let destroyed = false
    let url = ''
    const events = new Map<string, () => void>()
    const webContentsEvents = new Map<string, (...args: any[]) => void>()
    const webContents = {
      getURL: vi.fn(() => url),
      setUserAgent: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: (...args: any[]) => void) => webContentsEvents.set(event, listener)),
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('"type":"state"')) return { ...state }
        if (script.includes("document.querySelectorAll('button')")) return true
        return null
      }),
    }
    return {
      options,
      webContents,
      loadURL: vi.fn(async (next: string) => { url = next; await loadBehavior?.() }),
      show: vi.fn(), hide: vi.fn(), focus: vi.fn(), setSkipTaskbar: vi.fn(),
      isDestroyed: vi.fn(() => destroyed),
      on: vi.fn((event: string, listener: () => void) => events.set(event, listener)),
      destroy: vi.fn(() => { if (destroyed) return; destroyed = true; events.get('closed')?.() }),
      setUrl: (next: string) => { url = next },
      emitWebContents: (event: string, ...args: any[]) => webContentsEvents.get(event)?.(...args),
    }
  }

  const BrowserWindow = vi.fn(function (options: Electron.BrowserWindowConstructorOptions) {
    const win = makeWindow(options)
    windows.push(win)
    return win
  })
  return {
    windows, BrowserWindow, componentReady, clearStorageData, setPermissionRequestHandler, setPermissionCheckHandler,
    chrome, openChrome,
    setState(next: typeof state) { state = next },
    setLoadBehavior(next: typeof loadBehavior) { loadBehavior = next },
    reset() {
      windows.length = 0
      loadBehavior = undefined
      state = { connected: true, loggedIn: false, subscription: 'unknown', storefront: 'cn', playbackId: '', status: 'idle', position: 0, duration: 0 }
    },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: h.BrowserWindow,
  components: { whenReady: h.componentReady },
  session: { fromPartition: vi.fn(() => ({
    clearStorageData: h.clearStorageData,
    setPermissionRequestHandler: h.setPermissionRequestHandler,
    setPermissionCheckHandler: h.setPermissionCheckHandler,
  })) },
}))
vi.mock('./apple-music-chrome-page', () => ({
  AppleMusicChromePage: { open: h.openChrome },
}))

import { OfficialAppleMusicSession } from './apple-music-web-session'

const signedIn = { connected: true, loggedIn: true, subscription: 'active' as const, storefront: 'cn', playbackId: '', status: 'idle', position: 0, duration: 0 }
let apple: OfficialAppleMusicSession

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  h.reset()
  apple = new OfficialAppleMusicSession('/tmp/simple-music-test')
})
afterEach(async () => { await apple.close(); vi.useRealTimers() })

describe('应用内 Apple Music 会话', () => {
  it('开发态使用系统 Chrome 的正式 Widevine 会话', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    h.setState(signedIn)

    await apple.open()
    await vi.advanceTimersByTimeAsync(0)

    expect(h.openChrome).toHaveBeenCalledWith('/tmp/simple-music-test', expect.any(Function))
    expect(h.BrowserWindow).not.toHaveBeenCalled()
    expect(apple.state()).toMatchObject({ loggedIn: true, subscription: 'active' })
    expect(h.chrome.minimize).toHaveBeenCalled()
  })

  it('Chrome 播放命令允许 MusicKit 完成较慢的 DRM 队列加载', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    h.setState(signedIn)
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)

    apple.command({ type: 'load', playbackId: 'p1', id: '123' })
    await vi.advanceTimersByTimeAsync(0)

    expect(h.chrome.evaluate).toHaveBeenCalledWith(expect.stringContaining('"type":"command"'), 60_000)
    expect(h.chrome.show).toHaveBeenCalledTimes(2)
  })

  it('Chrome 落地地区与账号不同时通过 CDP 导航后再轮询', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    h.chrome.evaluate.mockResolvedValueOnce({ ...signedIn, redirectUrl: 'https://music.apple.com/cn/new' } as any)

    await apple.open()
    await vi.advanceTimersByTimeAsync(0)

    expect(h.chrome.navigate).toHaveBeenCalledWith('https://music.apple.com/cn/new')
    expect(h.chrome.minimize).not.toHaveBeenCalled()
  })

  it('使用隔离持久会话和安全的后台播放窗口', async () => {
    await apple.open()
    const win = h.windows[0]

    expect(h.componentReady).toHaveBeenCalledOnce()
    expect(h.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      webPreferences: expect.objectContaining({
        partition: 'persist:simplemusic-apple-music',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      }),
    }))
    expect(win.loadURL).toHaveBeenCalledWith('https://music.apple.com/')
    expect(win.show).toHaveBeenCalledOnce()
    expect(h.setPermissionRequestHandler).toHaveBeenCalledOnce()
    expect(h.setPermissionCheckHandler).toHaveBeenCalledOnce()

    const check = h.setPermissionCheckHandler.mock.calls[0][0]
    expect(check(null, 'mediaKeySystem', 'https://music.apple.com')).toBe(true)
    expect(check(null, 'storage-access', 'https://idmsa.apple.com')).toBe(true)
    expect(check(null, 'top-level-storage-access', 'https://idmsa.apple.com')).toBe(true)
    expect(check(null, 'media', 'https://music.apple.com')).toBe(false)
    expect(check(null, 'mediaKeySystem', 'https://example.com')).toBe(false)
    const request = h.setPermissionRequestHandler.mock.calls[0][0]
    const callback = vi.fn()
    request(null, 'mediaKeySystem', callback, { requestingUrl: 'https://music.apple.com/us/new' })
    expect(callback).toHaveBeenCalledWith(true)
    request(null, 'storage-access', callback, { requestingUrl: 'https://idmsa.apple.com' })
    expect(callback).toHaveBeenLastCalledWith(true)
    request(null, 'media', callback, { requestingUrl: 'https://music.apple.com' })
    expect(callback).toHaveBeenLastCalledWith(false)
  })

  it('授权完成后自动隐藏窗口，后续播放仍保持连接', async () => {
    h.setState(signedIn)
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    const win = h.windows[0]

    expect(apple.state()).toMatchObject({ connected: true, loggedIn: true })
    expect(win.hide).toHaveBeenCalledOnce()
    expect(win.setSkipTaskbar).toHaveBeenCalledWith(true)
    expect(win.destroy).not.toHaveBeenCalled()
  })

  it('已授权会话再次打开时保持后台，不重复创建窗口', async () => {
    h.setState(signedIn)
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    await apple.open()

    expect(h.BrowserWindow).toHaveBeenCalledOnce()
    expect(h.windows[0].hide).toHaveBeenCalledTimes(2)
  })

  it('打开期间取消时不会遗留后台窗口', async () => {
    let finish!: () => void
    h.componentReady.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const opening = apple.open()
    const result = expect(opening).rejects.toThrow('连接已取消')
    const closing = apple.close()
    finish()
    await closing
    await result
    expect(h.BrowserWindow).not.toHaveBeenCalled()
  })

  it('受保护媒体组件无响应时有界失败，取消不会卡住', async () => {
    h.componentReady.mockImplementationOnce(() => new Promise<void>(() => {}))
    const opening = apple.open()
    const failed = expect(opening).rejects.toThrow('组件加载超时')
    await vi.advanceTimersByTimeAsync(30000)
    await failed
    await expect(apple.close()).resolves.toBeUndefined()
  })

  it('取消无响应的首次连接后可以立即重新连接', async () => {
    h.componentReady.mockImplementationOnce(() => new Promise<void>(() => {}))
    const opening = apple.open()
    const cancelled = expect(opening).rejects.toThrow('连接已取消')
    await apple.close()
    await cancelled

    await apple.open()
    expect(h.BrowserWindow).toHaveBeenCalledOnce()
  })

  it('官网加载无响应时销毁窗口并返回明确错误', async () => {
    h.setLoadBehavior(() => new Promise<void>(() => {}))
    const opening = apple.open()
    const failed = expect(opening).rejects.toThrow('官网加载超时')
    await vi.advanceTimersByTimeAsync(30000)
    await failed
    expect(h.windows[0].destroy).toHaveBeenCalledOnce()
  })

  it('播放页面崩溃后清理死会话并允许重新创建', async () => {
    await apple.open()
    const first = h.windows[0]
    first.emitWebContents('render-process-gone')
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(apple.state()).toMatchObject({ connected: false, loggedIn: false, status: 'idle' })

    await apple.open()
    expect(h.BrowserWindow).toHaveBeenCalledTimes(2)
  })

  it('退出登录销毁播放环境并清除应用内授权数据', async () => {
    await apple.open()
    const win = h.windows[0]
    await apple.logout()

    expect(win.destroy).toHaveBeenCalledOnce()
    expect(h.clearStorageData).toHaveBeenCalledOnce()
    expect(apple.state().loggedIn).toBe(false)
  })

  it('播放命令直接在隐藏应用窗口执行', async () => {
    h.setState(signedIn)
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    const win = h.windows[0]

    apple.command({ type: 'load', playbackId: 'new', id: '123' })
    apple.command({ type: 'pause', playbackId: 'new' })
    await vi.advanceTimersByTimeAsync(0)
    const scripts = win.webContents.executeJavaScript.mock.calls.map(call => call[0])
    expect(scripts.some(script => script.includes('"type":"invalidate"'))).toBe(true)
    expect(scripts.some(script => script.includes('"type":"suspend"'))).toBe(true)
    expect(scripts.filter(script => script.includes('"type":"command"'))).toHaveLength(2)
  })

  it.each([
    ['inactive', '没有有效的 Apple Music 订阅'],
    ['unknown', '暂时无法确认 Apple Music 订阅状态'],
  ] as const)('订阅状态为 %s 时在发送播放命令前阻止播放', async (subscription, message) => {
    h.setState({ ...signedIn, subscription })
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    const win = h.windows[0]
    const calls = win.webContents.executeJavaScript.mock.calls.length
    expect(() => apple.command({ type: 'load', playbackId: 'new', id: '123' })).toThrow(message)
    expect(win.webContents.executeJavaScript).toHaveBeenCalledTimes(calls)
  })

  it('非官网页面不执行调用，恶意指令在执行前拒绝', async () => {
    h.setState(signedIn)
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(() => apple.command({ type: 'load', playbackId: 'p', id: '../secret' })).toThrow('歌曲编号')
    expect(() => apple.command({ type: 'volume', playbackId: 'p', volume: 2 })).toThrow('参数')
    h.windows[0].setUrl('https://example.com/')
    await expect(apple.catalog('/v1/catalog/cn/songs')).rejects.toThrow('授权窗口')
  })
})
