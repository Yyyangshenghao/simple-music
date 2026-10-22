import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  ui: null as any,
  windows: [] as any[]
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: any[]) => any) => h.handlers.set(name, fn),
    on: (name: string, fn: (...args: any[]) => any) => h.listeners.set(name, fn)
  },
  BrowserWindow: class extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: 'http://127.0.0.1:5173/playback-host.html' },
      isDestroyed: () => this.destroyed,
      send: vi.fn(), setWindowOpenHandler: vi.fn()
    })
    constructor(public options: unknown) { super(); h.windows.push(this) }
    isDestroyed() { return this.destroyed }
    loadURL = vi.fn(async () => {})
    destroy() { this.destroyed = true; this.emit('closed') }
  }
}))
vi.mock('./window-manager', () => ({
  getMainWindow: () => h.ui,
  resolveRendererUrl: (entry: string) => `http://127.0.0.1:5173/${entry}`
}))

async function setup() {
  vi.resetModules()
  h.handlers.clear(); h.listeners.clear(); h.windows = []
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'http://127.0.0.1:5173/index.html#/library' },
    isDestroyed: () => false, send: vi.fn()
  })
  h.ui = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false })
  const module = await import('./playback-host')
  module.registerPlaybackHostIpc()
  const host = module.createPlaybackHost(35530, 'token')
  module.attachPlaybackUi(h.ui)
  return { module, host, uiEvent: { sender: contents, senderFrame: contents.mainFrame }, hostEvent: { sender: host.webContents, senderFrame: host.webContents.mainFrame } }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('独立后台宿主与 IPC', () => {
  it('使用独立持久分区和隐藏沙盒，单次创建；界面订阅之前不自动起播', async () => {
    const { module, host } = await setup()
    expect(h.windows[0].options).toMatchObject({ show: false, paintWhenInitiallyHidden: false,
      webPreferences: { partition: 'persist:simplemusic-playback-v1', sandbox: true, contextIsolation: true, nodeIntegration: false } })
    expect(module.createPlaybackHost(35530, 'token')).toBe(host)
    expect(host.webContents.send).not.toHaveBeenCalled()
    expect(module.isPlaybackHostReady()).toBe(false)
  })

  it('宿主完成加载后按受理顺序派发，不等待前一动作完成', async () => {
    const { host, uiEvent, hostEvent } = await setup()
    const request = h.handlers.get('playback:request')!
    const first = request(uiEvent, { type: 'connect', storage: { settings: '{}' } })
    const second = request(uiEvent, { type: 'action', store: 'player', action: 'pause', args: [] })
    expect(host.webContents.send).not.toHaveBeenCalled()
    host.webContents.emit('did-finish-load')
    const calls = vi.mocked(host.webContents.send).mock.calls
    expect(calls.map(call => (call[1] as any).request.type)).toEqual(['connect', 'action'])
    h.listeners.get('playback:reply')!(hostEvent, { id: (calls[1][1] as any).id, result: { value: 'paused' } })
    await expect(second).resolves.toBe('paused')
    h.listeners.get('playback:reply')!(hostEvent, { id: (calls[0][1] as any).id, result: { value: 'connected' } })
    await expect(first).resolves.toBe('connected')
  })

  it('拒绝其他窗口、子 frame、同源其他入口以及畸形请求', async () => {
    const { uiEvent } = await setup()
    const request = h.handlers.get('playback:request')!
    const payload = { type: 'observe', visible: true }
    await expect(request({ ...uiEvent, sender: {} }, payload)).rejects.toThrow('INVALID_PLAYBACK_REQUEST')
    await expect(request({ ...uiEvent, senderFrame: { url: uiEvent.senderFrame.url } }, payload)).rejects.toThrow('INVALID_PLAYBACK_REQUEST')
    uiEvent.senderFrame.url = 'http://127.0.0.1:5173/other.html'
    await expect(request(uiEvent, payload)).rejects.toThrow('INVALID_PLAYBACK_REQUEST')
    uiEvent.senderFrame.url = 'http://127.0.0.1:5173/index.html'
    await expect(request(uiEvent, { type: 'connect', storage: { credential: 1 } })).rejects.toThrow('INVALID_PLAYBACK_REQUEST')
  })

  it('界面销毁取消未完成动作并停止观察，不重放旧命令', async () => {
    const { host, uiEvent, hostEvent } = await setup()
    host.webContents.emit('did-finish-load')
    const response = h.handlers.get('playback:request')!(uiEvent, { type: 'action', store: 'player', action: 'load', args: [], requestId: 'ui-request' })
    const failure = expect(response).rejects.toThrow('PLAYBACK_UI_DISCONNECTED')
    h.ui.emit('closed')
    await failure
    const commands = vi.mocked(host.webContents.send).mock.calls.map(call => call[1] as any)
    expect(commands.at(-4).request).toEqual({ type: 'cancel', requestId: 'ui-request' })
    expect(commands.at(-3).request).toEqual({ type: 'action', store: 'shortcuts', action: 'setRecording', args: [false] })
    expect(commands.at(-2).request).toEqual({ type: 'action', store: 'controls', action: 'cancelLyricsSelection', args: [] })
    expect(commands.at(-1).request).toEqual({ type: 'observe', visible: false, spectrum: false })
    h.listeners.get('playback:reply')!(hostEvent, { id: commands[0].id, result: { value: 'late' } })
  })

  it('只接受合法递增快照，频谱不改变状态版本且限制长度', async () => {
    const { module, hostEvent } = await setup()
    const publish = h.listeners.get('playback:publish')!
    const snapshot = { session: 'session', revision: 1, stores: { player: { status: 'paused' } } }
    publish({ ...hostEvent, sender: {} }, snapshot)
    expect(module.isPlaybackHostReady()).toBe(false)
    publish(hostEvent, snapshot)
    expect(module.isPlaybackHostReady()).toBe(true)
    publish(hostEvent, snapshot)
    publish(hostEvent, { ...snapshot, session: 'old', revision: 2 })
    expect(h.ui.webContents.send).toHaveBeenCalledTimes(1)
    publish(hostEvent, { type: 'spectrum', data: new Uint8Array(128) })
    publish(hostEvent, { type: 'spectrum', data: new Uint8Array(4097) })
    expect(h.ui.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('宿主崩溃清除等待请求并上报错误，不自动创建第二路音频', async () => {
    const { module, host, uiEvent } = await setup()
    host.webContents.emit('did-finish-load')
    const response = h.handlers.get('playback:request')!(uiEvent, { type: 'observe', visible: true })
    const failure = expect(response).rejects.toThrow('PLAYBACK_HOST_GONE')
    host.webContents.emit('render-process-gone')
    await failure
    expect(module.getPlaybackHost()).toBeNull()
    expect(h.windows).toHaveLength(1)
    expect(h.ui.webContents.send).toHaveBeenCalledWith('playback:snapshot', { type: 'host-error', error: 'PLAYBACK_HOST_GONE' })
  })

  it('等待有上限，超时通知取消并拒绝迟到回执', async () => {
    const { host, uiEvent } = await setup()
    host.webContents.emit('did-finish-load')
    const response = h.handlers.get('playback:request')!(uiEvent, { type: 'action', store: 'player', action: 'load', args: [], requestId: 'slow' })
    const failure = expect(response).rejects.toThrow('PLAYBACK_REQUEST_TIMEOUT')
    await vi.advanceTimersByTimeAsync(120000)
    await failure
    expect(vi.mocked(host.webContents.send).mock.calls.at(-1)?.[1]).toMatchObject({ request: { type: 'cancel', requestId: 'slow' } })
  })
})

it('大于单次命令上限的合法宿主快照与回执不会被静默丢弃', async () => {
  const { host, hostEvent, uiEvent } = await setup()
  host.webContents.emit('did-finish-load')
  const large = 'x'.repeat(8 * 1024 * 1024 + 1)
  const snapshot = { session: 'large-session', revision: 1, stores: { navigation: { history: [large] } } }
  h.listeners.get('playback:publish')!(hostEvent, snapshot)
  expect(h.ui.webContents.send).toHaveBeenCalledWith('playback:snapshot', snapshot)
  const response = h.handlers.get('playback:request')!(uiEvent, { type: 'connect', storage: {} })
  const command = vi.mocked(host.webContents.send).mock.calls.at(-1)![1] as { id: string }
  h.listeners.get('playback:reply')!(hostEvent, { id: command.id, result: { value: snapshot } })
  await expect(response).resolves.toBe(snapshot)
})
