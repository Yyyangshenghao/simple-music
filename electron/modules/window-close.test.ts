import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const h = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), rename: vi.fn(), unlink: vi.fn(),
  quit: vi.fn(), dialog: vi.fn(), quitting: false
}))
vi.mock('node:fs', () => ({ readFileSync: h.read, writeFileSync: h.write, renameSync: h.rename, unlinkSync: h.unlink }))
vi.mock('electron', () => ({
  app: { getPath: () => '/test/user-data', quit: h.quit },
  dialog: { showMessageBox: h.dialog }
}))

function fixture() {
  const events = new Map<string, (...args: any[]) => void>()
  const webEvents = new Map<string, () => void>()
  const win = {
    isDestroyed: vi.fn(() => false), isMinimized: () => false,
    show: vi.fn(), hide: vi.fn(), focus: vi.fn(), restore: vi.fn(),
    webContents: { send: vi.fn(), on: (name: string, cb: () => void) => webEvents.set(name, cb) },
    on: (name: string, cb: (...args: any[]) => void) => events.set(name, cb)
  }
  return { win, events, webEvents }
}

async function setup(ready = true) {
  const api = await import('./window-close')
  const f = fixture()
  api.attachWindowClose(f.win as unknown as BrowserWindow, () => h.quitting)
  if (ready) api.getWindowCloseState()
  const close = () => {
    const event = { preventDefault: vi.fn() }
    f.events.get('close')!(event)
    return event
  }
  return { ...f, api, close }
}

describe('Windows 关闭偏好与确认', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    h.quitting = false
    h.read.mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) })
    h.write.mockImplementation(() => {})
    h.rename.mockImplementation(() => {})
    h.dialog.mockResolvedValue({ response: 2, checkboxChecked: false })
  })
  afterEach(() => vi.restoreAllMocks())

  it('默认只打开一个应用内确认，取消后仍需询问且不记住取消', async () => {
    const { api, win, close } = await setup()
    expect(close().preventDefault).toHaveBeenCalledOnce()
    const first = api.getWindowCloseState().promptId!
    close()
    expect(api.getWindowCloseState().promptId).toBe(first)
    expect(win.webContents.send).toHaveBeenCalledOnce()
    expect(h.dialog).not.toHaveBeenCalled()
    api.resolveWindowClose({ promptId: first, action: 'cancel', remember: true })
    expect(h.write).not.toHaveBeenCalled()
    expect(win.hide).not.toHaveBeenCalled()
    close()
    expect(api.getWindowCloseState().promptId).not.toBe(first)
  })

  it.each(['tray', 'quit'] as const)('记住 %s 后跳过下次询问，并跨模块重启读取', async (action) => {
    const { api, win, close } = await setup()
    close()
    api.resolveWindowClose({ promptId: api.getWindowCloseState().promptId!, action, remember: true })
    expect(h.write).toHaveBeenCalledWith('/test/user-data/window-close.json.tmp', JSON.stringify({ behavior: action }), { mode: 0o600 })
    expect(h.rename).toHaveBeenCalledWith('/test/user-data/window-close.json.tmp', '/test/user-data/window-close.json')
    close()
    expect(action === 'tray' ? win.hide : h.quit).toHaveBeenCalledTimes(2)
    h.read.mockReturnValue(JSON.stringify({ behavior: action }))
    vi.resetModules()
    const next = await setup()
    expect(next.api.getWindowCloseState().behavior).toBe(action)
    next.api.setWindowCloseBehavior('ask')
    next.close()
    expect(next.api.getWindowCloseState().promptId).not.toBeNull()
  })

  it('只做本次选择时不写偏好，旧确认结果不影响新确认', async () => {
    const { api, win, close } = await setup()
    close()
    const first = api.getWindowCloseState().promptId!
    api.resolveWindowClose({ promptId: first, action: 'tray', remember: false })
    expect(win.hide).toHaveBeenCalledOnce()
    expect(h.write).not.toHaveBeenCalled()
    close()
    api.resolveWindowClose({ promptId: first, action: 'quit', remember: true })
    expect(h.quit).not.toHaveBeenCalled()
    expect(api.getWindowCloseState().promptId).not.toBeNull()
  })

  it('保存失败不关闭窗口、不更新偏好，允许不记住后重试', async () => {
    const { api, win, close } = await setup()
    close()
    const choice = { promptId: api.getWindowCloseState().promptId!, action: 'tray' as const, remember: true }
    h.rename.mockImplementationOnce(() => { throw new Error('disk full') })
    expect(() => api.resolveWindowClose(choice)).toThrow('disk full')
    expect(api.getWindowCloseState()).toEqual({ behavior: 'ask', promptId: choice.promptId })
    expect(win.hide).not.toHaveBeenCalled()
    expect(h.unlink).toHaveBeenCalled()
    api.resolveWindowClose({ ...choice, remember: false })
    expect(win.hide).toHaveBeenCalledOnce()
  })

  it('损坏或非法偏好安全回到每次询问，拒绝非法设置与确认', async () => {
    h.read.mockReturnValue('{"behavior":"destroy"}')
    const { api, close } = await setup()
    expect(api.getWindowCloseState().behavior).toBe('ask')
    expect(() => api.setWindowCloseBehavior('destroy' as never)).toThrow()
    close()
    expect(() => api.resolveWindowClose({ promptId: api.getWindowCloseState().promptId!, action: 'destroy' as never, remember: false })).toThrow()
    expect(h.quit).not.toHaveBeenCalled()
  })

  it('界面尚未就绪时使用系统兜底，记住选择同样生效', async () => {
    h.dialog.mockResolvedValueOnce({ response: 0, checkboxChecked: true })
    const { api, win, close } = await setup(false)
    close()
    close()
    await Promise.resolve()
    expect(h.dialog).toHaveBeenCalledOnce()
    expect(h.dialog).toHaveBeenCalledWith(win, expect.objectContaining({ checkboxLabel: '记住这次选择', cancelId: 2 }))
    expect(win.hide).toHaveBeenCalledOnce()
    expect(api.getWindowCloseState().behavior).toBe('tray')
  })

  it('重载后可重新获取待确认状态，崩溃后关闭仍可用系统兜底', async () => {
    const { api, webEvents, close } = await setup()
    close()
    const first = api.getWindowCloseState().promptId
    webEvents.get('did-start-loading')!()
    expect(api.getWindowCloseState().promptId).toBe(first)
    webEvents.get('render-process-gone')!()
    close()
    expect(h.dialog).toHaveBeenCalledOnce()
    await Promise.resolve()
  })

  it('渲染进程崩溃后的系统兜底不依赖页面收消息，仍能执行退出', async () => {
    h.dialog.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    const { win, webEvents, close } = await setup()
    webEvents.get('render-process-gone')!()
    win.webContents.send.mockImplementation(() => { throw new Error('render frame disposed') })
    close()
    await Promise.resolve()
    expect(h.quit).toHaveBeenCalledOnce()
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('主动退出、销毁以及退出中的异步结果都不再隐藏或保存', async () => {
    const { api, win, close } = await setup()
    close()
    const promptId = api.getWindowCloseState().promptId!
    h.quitting = true
    expect(close().preventDefault).not.toHaveBeenCalled()
    api.resolveWindowClose({ promptId, action: 'tray', remember: true })
    expect(win.hide).not.toHaveBeenCalled()
    expect(h.write).not.toHaveBeenCalled()
  })
})
