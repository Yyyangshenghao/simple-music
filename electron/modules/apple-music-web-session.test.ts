import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const h = vi.hoisted(() => {
  const readFile = vi.fn(() => 'false')
  const writeFile = vi.fn()
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
  const openChrome = vi.fn(async (_directory: string, _onClose: () => void, _signal?: AbortSignal) => chrome)
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
      show: vi.fn(), hide: vi.fn(), focus: vi.fn(), minimize: vi.fn(), setSkipTaskbar: vi.fn(),
      isDestroyed: vi.fn(() => destroyed),
      on: vi.fn((event: string, listener: () => void) => events.set(event, listener)),
      destroy: vi.fn(() => { if (destroyed) return; destroyed = true; events.get('closed')?.() }),
      setUrl: (next: string) => { url = next },
      emit: (event: string) => events.get(event)?.(),
      emitWebContents: (event: string, ...args: any[]) => webContentsEvents.get(event)?.(...args),
    }
  }

  const BrowserWindow = vi.fn(function (options: Electron.BrowserWindowConstructorOptions) {
    const win = makeWindow(options)
    windows.push(win)
    return win
  })
  return {
    readFile, writeFile, windows, BrowserWindow, componentReady, clearStorageData, setPermissionRequestHandler, setPermissionCheckHandler,
    chrome, openChrome,
    setState(next: typeof state) { state = next },
    setLoadBehavior(next: typeof loadBehavior) { loadBehavior = next },
    reset() {
      chrome.evaluate.mockReset().mockImplementation(async script => script.includes('"type":"state"') ? { ...state } : true)
      chrome.close.mockReset().mockResolvedValue()
      readFile.mockReturnValue('false')
      windows.length = 0
      loadBehavior = undefined
      state = { connected: true, loggedIn: false, subscription: 'unknown', storefront: 'cn', playbackId: '', status: 'idle', position: 0, duration: 0 }
    },
  }
})

vi.mock('node:fs', () => ({ readFileSync: h.readFile, writeFileSync: h.writeFile }))

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
  it('显式登录在受保护媒体组件就绪前立即显示窗口', async () => {
    let finish!: () => void
    h.componentReady.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const opening = apple.open()
    void opening.catch(() => {})
    expect(h.BrowserWindow).toHaveBeenCalledOnce()
    const win = h.windows[0]
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(win.loadURL).not.toHaveBeenCalled()
    finish()
    await opening
    expect(win.loadURL).toHaveBeenCalledWith('https://music.apple.com/')
    expect(win.show).toHaveBeenCalledOnce()
  })

  it('显式登录在官网仍加载时显示窗口且不重复抢焦点', async () => {
    let finish!: () => void
    h.setLoadBehavior(() => new Promise<void>(resolve => { finish = resolve }))
    const opening = apple.open()
    void opening.catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    const win = h.windows[0]
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    finish()
    await opening
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
  })

  it('未登录窗口最小化后再次显式登录会重显并聚焦同一窗口', async () => {
    await apple.open()
    const win = h.windows[0]
    win.minimize()
    await apple.open()
    expect(h.BrowserWindow).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledTimes(2)
    expect(win.focus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(win.show).toHaveBeenCalledTimes(2)
    expect(win.focus).toHaveBeenCalledTimes(2)
  })

  it.each(['组件', '官网'])('显式登录立即接管仍等待%s的静默恢复窗口', async waiting => {
    h.readFile.mockReturnValue('true')
    let finish!: () => void
    const pending = () => new Promise<void>(resolve => { finish = resolve })
    if (waiting === '组件') h.componentReady.mockImplementationOnce(pending)
    else h.setLoadBehavior(pending)
    const restoring = apple.restore()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.BrowserWindow).toHaveBeenCalledOnce()
    const win = h.windows[0]
    expect(win.show).not.toHaveBeenCalled()
    const opening = apple.open()
    void opening.catch(() => {})
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(apple.state().restoring).toBe(false)
    finish()
    await Promise.all([restoring, opening])
    expect(h.BrowserWindow).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
  })

  it('登录按钮脚本无响应时连接有界完成并继续轮询授权', async () => {
    h.setLoadBehavior(async () => {
      const win = h.windows[0]
      const execute = win.webContents.executeJavaScript.getMockImplementation()!
      win.webContents.executeJavaScript.mockImplementation(script => script.includes("document.querySelectorAll('button')")
        ? new Promise<never>(() => {}) : execute(script))
    })
    const opening = apple.open()
    let opened = false
    void opening.then(() => { opened = true }, () => {})
    await vi.advanceTimersByTimeAsync(15000)
    expect(opened).toBe(true)
    await opening
    h.setState(signedIn)
    await vi.advanceTimersByTimeAsync(1000)
    expect(apple.state().loggedIn).toBe(true)
    expect(h.windows[0].hide).toHaveBeenCalledOnce()
  })

  it('登录启动中退出会取消启动并等待晚到的 Chrome 清理', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    let finish!: (value: typeof h.chrome) => void
    h.openChrome.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const opening = apple.open()
    const rejected = expect(opening).rejects.toThrow('连接已取消')
    const closing = apple.close()
    let done = false
    void closing.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    finish(h.chrome)
    await closing
    await rejected
    expect(h.chrome.close).toHaveBeenCalled()
    expect(h.chrome.show).not.toHaveBeenCalled()
    expect(apple.state().connected).toBe(false)
  })

  it('重复关闭仍等待同一轮后台清理完成', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    let finish!: () => void
    h.chrome.close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const first = apple.close()
    const second = apple.close()
    let done = false
    void second.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    finish()
    await Promise.all([first, second])
    expect(h.chrome.close).toHaveBeenCalledOnce()
  })

  it('连接断开正在清理时退出仍等待专用浏览器结束', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    let finish!: () => void
    h.chrome.close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const onClose = h.openChrome.mock.calls.at(-1)![1] as () => void
    onClose()
    let done = false
    const closing = apple.close().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    finish()
    await closing
    expect(h.chrome.close).toHaveBeenCalledOnce()
  })
  it.each([false, true])('官网登录脚本尚未就绪时保留登录窗口（Chrome：%s）', async chrome => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', chrome)
    if (chrome) h.chrome.evaluate.mockRejectedValueOnce(new Error('Apple Music 官网仍在加载，请稍候'))
    else h.setLoadBehavior(async () => { h.windows[0].webContents.executeJavaScript.mockRejectedValueOnce(new Error('Apple Music 官网仍在加载，请稍候')) })
    await apple.open()
    const evaluate = chrome ? h.chrome.evaluate : h.windows[0].webContents.executeJavaScript
    evaluate.mockRejectedValueOnce(new Error('Apple Music 官网仍在加载，请稍候'))
      .mockRejectedValueOnce(new Error('Apple Music 官网仍在加载，请稍候'))
      .mockRejectedValueOnce(new Error('Apple Music 官网仍在加载，请稍候'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(chrome ? h.chrome.close : h.windows[0].destroy).not.toHaveBeenCalled()
    h.setState(signedIn)
    await vi.advanceTimersByTimeAsync(1000)
    expect(apple.state()).toMatchObject({ connected: true, loggedIn: true })
  })

  it('官网登录页面持续不可用时有界退出，重试不携带旧错误', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    h.chrome.evaluate.mockRejectedValue(new Error('Apple Music 官网仍在加载，请稍候'))
    await apple.open()
    await vi.advanceTimersByTimeAsync(29_000)
    expect(h.chrome.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.chrome.close).toHaveBeenCalledOnce()
    expect(apple.state().error).toBeTruthy()
    await apple.open()
    expect(apple.state().error).toBeUndefined()
  })

  it('旧歌曲命令失败不关闭已切换的新歌曲会话', async () => {
    h.setState(signedIn)
    await apple.open()
    const win = h.windows[0]
    let reject!: (error: Error) => void
    const execute = win.webContents.executeJavaScript.getMockImplementation()!
    win.webContents.executeJavaScript.mockImplementation(async script => {
      if (script.includes('"type":"command"') && script.includes('"playbackId":"old"')) {
        return new Promise<never>((_, fail) => { reject = fail })
      }
      return execute(script)
    })
    apple.command({ type: 'load', playbackId: 'old', id: '123' })
    await vi.advanceTimersByTimeAsync(0)
    apple.command({ type: 'load', playbackId: 'new', id: '456' })
    reject(new Error('旧请求超时'))
    await vi.advanceTimersByTimeAsync(0)
    expect(win.destroy).not.toHaveBeenCalled()
    expect(apple.state()).toMatchObject({ loggedIn: true, playbackId: 'new' })
    expect(win.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('"id":"456"'), true)
  })

  it('当前播放指令失败保留操作类型和原始原因', async () => {
    h.setState(signedIn)
    await apple.open()
    const win = h.windows[0]
    const execute = win.webContents.executeJavaScript.getMockImplementation()!
    win.webContents.executeJavaScript.mockImplementation(async script => {
      if (script.includes('"type":"command"')) throw new Error('Chrome Apple Music 操作超时')
      return execute(script)
    })
    apple.command({ type: 'load', playbackId: 'p1', id: '123' })
    await vi.advanceTimersByTimeAsync(0)
    expect(apple.state()).toMatchObject({ status: 'error', error: expect.stringContaining('加载歌曲失败：Chrome Apple Music 操作超时') })
  })

  it('Chrome 关闭尚未完成时即可读取原始错误，关闭完成不覆盖新连接', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    h.setState(signedIn)
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    let finish!: () => void
    h.chrome.close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    h.chrome.evaluate.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('Chrome Apple Music 操作超时'))
    apple.command({ type: 'load', playbackId: 'p1', id: '123' })
    await vi.advanceTimersByTimeAsync(0)
    expect(apple.state()).toMatchObject({ playbackId: 'p1', status: 'error', error: expect.stringContaining('操作超时') })
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(apple.state()).toMatchObject({ connected: true, loggedIn: true, status: 'idle' })
  })

  it('显式登录窗口立即显示，确认已有授权后隐藏且不重复抢焦点', async () => {
    h.setState(signedIn)
    await apple.open()
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.windows[0].show).toHaveBeenCalledOnce()
    expect(h.windows[0].focus).toHaveBeenCalledOnce()
    expect(h.windows[0].hide).toHaveBeenCalledOnce()
  })

  it('Chrome 登录后返回主应用且不最小化播放窗口，播放时不抢焦点', async () => {
    const returnToApp = vi.fn()
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true, returnToApp)
    h.setState(signedIn)
    await apple.open()
    await vi.advanceTimersByTimeAsync(2000)
    apple.command({ type: 'load', playbackId: 'p1', id: '123' })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.chrome.show).toHaveBeenCalledOnce()
    expect(h.chrome.minimize).not.toHaveBeenCalled()
    expect(returnToApp).toHaveBeenCalledOnce()
  })

  it('后台队列合并尚未执行的拖动和音量，不延迟暂停', async () => {
    h.setState(signedIn)
    await apple.open()
    apple.command({ type: 'load', playbackId: 'p1', id: '123' })
    for (let index = 1; index <= 20; index++) {
      apple.command({ type: 'volume', playbackId: 'p1', volume: index / 20 })
      apple.command({ type: 'seek', playbackId: 'p1', seconds: index, controlSequence: index })
    }
    apple.command({ type: 'pause', playbackId: 'p1', controlSequence: 21 })
    await vi.advanceTimersByTimeAsync(0)
    const scripts = h.windows[0].webContents.executeJavaScript.mock.calls.map(([script]) => script)
      .filter(script => script.includes('"type":"command"'))
    expect(scripts).toHaveLength(4)
    expect(scripts[2]).toContain('"seconds":20')
    expect(scripts[3]).toContain('"type":"pause"')
  })

  it('只有发布版且有成功授权记录才启动静默恢复', async () => {
    await apple.restore()
    expect(h.BrowserWindow).not.toHaveBeenCalled()
    h.readFile.mockReturnValue('true')
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    await apple.restore()
    expect(h.openChrome).not.toHaveBeenCalled()
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test')
    h.setState(signedIn)
    await apple.restore()
    expect(apple.state().loggedIn).toBe(true)
    expect(h.windows[0].show).not.toHaveBeenCalled()
  })

  it('静默恢复期间报告恢复中，完成后撤销暂态', async () => {
    h.readFile.mockReturnValue('true')
    let finish!: () => void
    h.componentReady.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const restoring = apple.restore()
    expect(apple.state()).toMatchObject({ restoring: true, loggedIn: false })
    h.setState(signedIn)
    finish()
    await restoring
    expect(apple.state().restoring).toBe(false)
  })

  it('首次官网状态未登录时继续等待后续授权恢复', async () => {
    h.readFile.mockReturnValue('true')
    await apple.restore()
    expect(apple.state()).toMatchObject({ restoring: true, loggedIn: false })
    h.setState(signedIn)
    await vi.advanceTimersByTimeAsync(1000)
    expect(apple.state()).toMatchObject({ restoring: false, loggedIn: true })
  })

  it('旧授权始终无法恢复时有限等待并解除恢复中状态', async () => {
    h.readFile.mockReturnValue('true')
    await apple.restore()
    await vi.advanceTimersByTimeAsync(30000)
    expect(apple.state()).toMatchObject({ restoring: false, loggedIn: false })
  })

  it('失效的恢复会话不会弹窗或自动点击登录，显式登录仍能打开窗口', async () => {
    h.readFile.mockReturnValue('true')
    await apple.restore()
    await vi.advanceTimersByTimeAsync(2000)
    const win = h.windows[0]
    expect(win.show).not.toHaveBeenCalled()
    expect(win.webContents.executeJavaScript.mock.calls.some(([script]) => script.includes("document.querySelectorAll('button')"))).toBe(false)
    await apple.open()
    expect(win.show).toHaveBeenCalledOnce()
  })

  it('成功授权持久化布尔恢复标记，退出登录清除标记', async () => {
    h.setState(signedIn)
    await apple.open()
    expect(h.writeFile).toHaveBeenCalledWith(join('/tmp/simple-music-test', 'apple-music-restore'), 'true', expect.any(Object))
    await apple.logout()
    expect(h.writeFile).toHaveBeenLastCalledWith(join('/tmp/simple-music-test', 'apple-music-restore'), 'false', expect.any(Object))
  })

  it('恢复期间退出登录后销毁隐藏窗口且不迟到导航或重新记录登录', async () => {
    h.readFile.mockReturnValue('true')
    let finish!: () => void
    h.componentReady.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const restoring = apple.restore()
    await apple.logout()
    finish()
    await restoring
    expect(apple.state().restoring).toBe(false)
    expect(h.BrowserWindow).toHaveBeenCalledOnce()
    expect(h.windows[0].destroy).toHaveBeenCalledOnce()
    expect(h.windows[0].show).not.toHaveBeenCalled()
    expect(h.windows[0].loadURL).not.toHaveBeenCalled()
    expect(h.writeFile).not.toHaveBeenCalledWith(expect.any(String), 'true', expect.any(Object))
  })

  it('播放中及时同步自然结束，偶发读取失败保持会话', async () => {
    h.setState({ ...signedIn, playbackId: 'p1', status: 'playing', position: 179, duration: 180 })
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)
    h.windows[0].webContents.executeJavaScript.mockRejectedValueOnce(new Error('temporary'))
    await vi.advanceTimersByTimeAsync(250)
    expect(apple.state()).toMatchObject({ connected: true, status: 'playing' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(apple.state()).toMatchObject({ connected: true, status: 'playing' })
    h.setState({ ...signedIn, playbackId: 'p1', status: 'ended', position: 180, duration: 180 })
    await vi.advanceTimersByTimeAsync(250)
    expect(apple.state()).toMatchObject({ connected: true, status: 'ended' })
  })

  it('开发态使用系统 Chrome 的正式 Widevine 会话', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    h.setState(signedIn)

    await apple.open()
    await vi.advanceTimersByTimeAsync(0)

    expect(h.openChrome).toHaveBeenCalledWith('/tmp/simple-music-test', expect.any(Function), expect.any(AbortSignal))
    expect(h.BrowserWindow).not.toHaveBeenCalled()
    expect(apple.state()).toMatchObject({ loggedIn: true, subscription: 'active' })
    expect(h.chrome.minimize).not.toHaveBeenCalled()
  })

  it('Chrome 播放命令允许 MusicKit 完成较慢的 DRM 队列加载', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    h.setState(signedIn)
    await apple.open()
    await vi.advanceTimersByTimeAsync(0)

    apple.command({ type: 'load', playbackId: 'p1', id: '123' })
    await vi.advanceTimersByTimeAsync(0)

    expect(h.chrome.evaluate).toHaveBeenCalledWith(expect.stringContaining('"type":"command"'), 60_000)
    expect(h.chrome.show).toHaveBeenCalledTimes(1)
  })

  it('Chrome 落地地区与账号不同时通过 CDP 导航后再轮询', async () => {
    apple = new OfficialAppleMusicSession('/tmp/simple-music-test', true)
    h.chrome.evaluate.mockResolvedValueOnce({ ...signedIn, redirectUrl: 'https://music.apple.com/cn/new' } as any)

    await apple.open()
    await vi.advanceTimersByTimeAsync(0)

    expect(h.chrome.navigate).toHaveBeenCalledWith('https://music.apple.com/cn/new')
    expect(h.chrome.minimize).not.toHaveBeenCalled()
  })

  it('应用内网页地区与账号不同时导航到账号地区后再隐藏', async () => {
    h.setState(signedIn)
    h.setLoadBehavior(async () => {
      const win = h.windows[0]
      if (win.webContents.getURL() === 'https://music.apple.com/') {
        win.webContents.executeJavaScript.mockResolvedValueOnce({ ...signedIn, redirectUrl: 'https://music.apple.com/cn/new' } as any)
      }
    })

    await apple.open()
    const win = h.windows[0]
    expect(win.loadURL).toHaveBeenCalledWith('https://music.apple.com/cn/new')
    expect(apple.state()).toMatchObject({ loggedIn: false, subscription: 'unknown' })
    expect(() => apple.command({ type: 'load', playbackId: 'p1', id: '123' })).toThrow('请先')
    expect(win.hide).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4000)
    expect(win.hide).toHaveBeenCalledOnce()
  })

  it('官网改写地区页面地址时不反复导航', async () => {
    await apple.open()
    const win = h.windows[0]
    h.setState(signedIn)
    const execute = win.webContents.executeJavaScript.getMockImplementation()!
    win.webContents.executeJavaScript.mockImplementation(async script =>
      script.includes('"type":"state"') ? { ...signedIn, redirectUrl: 'https://music.apple.com/cn/new' } : execute(script))

    await vi.advanceTimersByTimeAsync(1000)
    expect(win.loadURL).toHaveBeenCalledWith('https://music.apple.com/cn/new')
    expect(apple.state()).toMatchObject({ loggedIn: false, subscription: 'unknown' })
    win.setUrl('https://music.apple.com/new')
    await vi.advanceTimersByTimeAsync(4000)
    expect(win.loadURL).toHaveBeenCalledTimes(2)
    expect(apple.state()).toMatchObject({ loggedIn: false, subscription: 'unknown', error: expect.stringContaining('地区不一致') })
    expect(win.hide).not.toHaveBeenCalled()
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
    expect(h.windows[0].hide).toHaveBeenCalledTimes(1)
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
    expect(h.BrowserWindow).toHaveBeenCalledOnce()
    expect(h.windows[0].destroy).toHaveBeenCalledOnce()
    expect(h.windows[0].loadURL).not.toHaveBeenCalled()
  })

  it('受保护媒体组件无响应时有界失败，取消不会卡住', async () => {
    h.componentReady.mockImplementationOnce(() => new Promise<void>(() => {}))
    const opening = apple.open()
    const failed = expect(opening).rejects.toThrow('组件加载超时')
    await vi.advanceTimersByTimeAsync(30000)
    await failed
    expect(h.windows[0].destroy).toHaveBeenCalledOnce()
    expect(h.windows[0].loadURL).not.toHaveBeenCalled()
    await expect(apple.close()).resolves.toBeUndefined()
  })

  it('取消无响应的首次连接后可以立即重新连接', async () => {
    h.componentReady.mockImplementationOnce(() => new Promise<void>(() => {}))
    const opening = apple.open()
    const cancelled = expect(opening).rejects.toThrow('连接已取消')
    await apple.close()
    await cancelled

    await apple.open()
    expect(h.BrowserWindow).toHaveBeenCalledTimes(2)
    expect(h.windows[0].destroy).toHaveBeenCalledOnce()
    expect(h.windows[1].isDestroyed()).toBe(false)
  })

  it('用户关闭仍等待媒体组件的授权窗口立即取消连接', async () => {
    h.componentReady.mockImplementationOnce(() => new Promise<void>(() => {}))
    const opening = apple.open()
    const cancelled = expect(opening).rejects.toThrow('连接已取消')
    h.windows[0].destroy()
    await cancelled
    expect(h.windows[0].loadURL).not.toHaveBeenCalled()
    await apple.open()
    expect(h.BrowserWindow).toHaveBeenCalledTimes(2)
  })

  it.each(['render-process-gone', 'unresponsive'])('等待媒体组件时发生 %s 会立即取消连接并允许重试', async event => {
    h.componentReady.mockImplementationOnce(() => new Promise<void>(() => {}))
    const opening = apple.open()
    let error = ''
    const cancelled = opening.catch(reason => { error = reason.message })
    const win = h.windows[0]
    if (event === 'render-process-gone') win.emitWebContents(event)
    else win.emit(event)
    await vi.advanceTimersByTimeAsync(0)
    expect(error).toBe('连接已取消')
    await cancelled
    expect(win.loadURL).not.toHaveBeenCalled()
    expect(win.destroy).toHaveBeenCalledOnce()
    await apple.open()
    expect(h.BrowserWindow).toHaveBeenCalledTimes(2)
    expect(h.windows[1].isDestroyed()).toBe(false)
  })

  it('媒体组件加载失败保留明确原因并销毁已显示窗口', async () => {
    h.componentReady.mockRejectedValueOnce(new Error('component unavailable'))
    await expect(apple.open()).rejects.toThrow('受保护媒体组件加载失败')
    expect(h.windows[0].destroy).toHaveBeenCalledOnce()
    expect(h.windows[0].loadURL).not.toHaveBeenCalled()
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
    apple.command({ type: 'pause', playbackId: 'new', controlSequence: 1 })
    await vi.advanceTimersByTimeAsync(0)
    const scripts = win.webContents.executeJavaScript.mock.calls.map(call => call[0])
    expect(scripts.some(script => script.includes('"type":"invalidate"'))).toBe(true)
    expect(scripts.some(script => script.includes('"type":"suspend","playbackId":"new","controlSequence":1'))).toBe(true)
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
