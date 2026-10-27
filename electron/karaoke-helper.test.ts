import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  messages: new Map<string, (value: unknown) => void>(),
  handlers: new Map<string, (...args: any[]) => any>(), frame: {},
  init: vi.fn(async () => true), infer: vi.fn(async (input: Float32Array) => input),
  exit: vi.fn(), priority: vi.fn(), window: null as any,
}))
vi.mock('node:os', async () => ({ ...await vi.importActual('node:os'), setPriority: h.priority }))
vi.mock('electron', () => ({
  app: { setActivationPolicy: vi.fn(), setPath: vi.fn(), exit: h.exit, commandLine: { appendSwitch: vi.fn() }, whenReady: async () => {} },
  ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => h.handlers.set(name, callback), on: vi.fn() },
  session: { defaultSession: { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() } },
  BrowserWindow: class {
    constructor() { h.window = this }
    isDestroyed = () => false
    webContents = { mainFrame: h.frame, on: vi.fn(), send: vi.fn(), setWindowOpenHandler: vi.fn() }
    loadURL = vi.fn(async () => {})
  },
}))
vi.mock('./modules/window-manager', () => ({ resolveRendererUrl: () => 'file:///karaoke-helper.html' }))
vi.mock('./modules/karaoke-helper', () => ({ KARAOKE_HELPER_FLAG: '--helper', KARAOKE_HELPER_DATA_ARG: '--data=' }))
vi.mock('./modules/karaoke-native', () => ({ createNativeInference: () => ({ init: h.init, infer: h.infer }) }))

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  h.messages.clear(); h.handlers.clear(); h.window = null
  vi.stubGlobal('process', { ...process, platform: 'darwin', argv: ['--helper', '--data=/profile/helper'],
    on: (name: string, callback: (value: unknown) => void) => h.messages.set(name, callback),
    once: (name: string, callback: (value: unknown) => void) => h.messages.set(name, callback),
  })
  const { runKaraokeHelper } = await import('./karaoke-helper')
  runKaraokeHelper()
})
afterEach(() => vi.unstubAllGlobals())

async function initialize() {
  h.messages.get('message')!({ type: 'init', port: 35530, token: 'test', userDataDir: '/profile' })
  await vi.waitFor(() => expect(h.handlers.has('karaoke-helper:native-init')).toBe(true))
  return { sender: h.window.webContents, senderFrame: h.frame }
}

describe('分离实例私有原生 IPC', () => {
  it('分离实例降低自身 CPU 优先级，系统拒绝时仍可生成', async () => {
    expect(h.priority).toHaveBeenCalledWith(0, 10)
    h.priority.mockImplementationOnce(() => { throw new Error('Denied') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { runKaraokeHelper } = await import('./karaoke-helper')
      expect(() => runKaraokeHelper()).not.toThrow()
      await initialize()
      expect(h.exit).not.toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })

  it('只接收当前分离页主框架的请求，并限定模型 ID', async () => {
    const event = await initialize()
    const init = h.handlers.get('karaoke-helper:native-init')!
    await expect(init(event, 'hq3')).resolves.toBe(true)
    expect(() => init({ ...event, sender: {} }, 'hq3')).toThrow('无效')
    expect(() => init({ ...event, senderFrame: {} }, 'hq3')).toThrow('无效')
    expect(() => init(event, '../other')).toThrow('无效')
    const infer = h.handlers.get('karaoke-helper:native-infer')!
    const data = new Float32Array(4)
    await expect(infer(event, data)).resolves.toBe(data)
    expect(() => infer({ ...event, senderFrame: {} }, data)).toThrow('无效')
    expect(h.infer).toHaveBeenCalledOnce()
  })

  it('缺少原始资料目录时不启动分离页或开放原生接口', async () => {
    h.messages.get('message')!({ type: 'init', port: 35530, token: 'test' })
    expect(h.exit).toHaveBeenCalledWith(1)
    expect(h.window).toBeNull()
    expect(h.handlers.size).toBe(0)
  })
})
