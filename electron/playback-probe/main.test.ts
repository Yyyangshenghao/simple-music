import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { ProbeHostCommand, ProbeSnapshot } from '../../src/types/playback-probe'

const h = vi.hoisted(() => ({
  events: new Map<string, (...args: any[]) => void>(), listeners: new Map<string, (...args: any[]) => void>(), handlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as any[], commands: [] as ProbeHostCommand[], state: null as ProbeSnapshot | null, reply: true,
  quit: vi.fn(), setPath: vi.fn(), server: vi.fn(), closeServer: vi.fn(), scan: vi.fn(), openDialog: vi.fn(),
  saveDialog: vi.fn(), writeFile: vi.fn(),
}))
vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }))
vi.mock('node:fs/promises', () => ({ writeFile: h.writeFile }))
vi.mock('../../server/index', () => ({ startServer: h.server }))
vi.mock('../../server/lib/local-library', () => ({ addLocalFolder: h.scan }))
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/probe-unit-test', setPath: h.setPath, setName: vi.fn(), commandLine: { appendSwitch: vi.fn() },
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), quit: h.quit,
    on: (name: string, listener: (...args: any[]) => void) => h.events.set(name, listener), getAppMetrics: () => [],
  },
  ipcMain: {
    on: (name: string, listener: (...args: any[]) => void) => h.listeners.set(name, listener),
    handle: (name: string, handler: (...args: any[]) => any) => h.handlers.set(name, handler),
  },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: (template: unknown) => template },
  dialog: { showOpenDialog: h.openDialog, showSaveDialog: h.saveDialog },
  BrowserWindow: class {
    destroyed = false
    url = ''
    events = new Map<string, (...args: any[]) => void>()
    webEvents = new Map<string, (...args: any[]) => void>()
    webContents = {
      mainFrame: {}, getURL: () => this.url,
      setWindowOpenHandler: vi.fn(), on: (name: string, listener: (...args: any[]) => void) => this.webEvents.set(name, listener),
      session: { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() },
      send: (channel: string, packet: { id: number; command: ProbeHostCommand }) => {
        if (channel !== 'probe:execute') return
        h.commands.push(packet.command)
        if (h.reply) h.listeners.get('probe:reply')?.({ sender: this.webContents, senderFrame: this.webContents.mainFrame }, { id: packet.id, snapshot: h.state })
      },
    }
    constructor(public options: any) { h.windows.push(this) }
    isDestroyed() { return this.destroyed }
    on(name: string, listener: (...args: any[]) => void) { this.events.set(name, listener) }
    async loadURL(url: string) { this.url = url }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.events.get('closed')?.() }
    show() {}
    focus() {}
  },
}))

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
async function boot() { await import('./main'); await flush() }
function ready() {
  const host = h.windows[0]
  const sessionId = host.options.webPreferences.additionalArguments.find((arg: string) => arg.startsWith('--probe-session=')).slice('--probe-session='.length)
  h.state = { sessionId, revision: 1, status: 'playing', current: { id: 'track', label: '测试', kind: 'local' },
    queueIndex: 0, queueLength: 1, position: 10, duration: 30, volume: 0.2, rate: 1, loadCount: 1, endedCount: 0, deviceChanges: 0, sleepAt: null, error: '' }
  h.listeners.get('probe:ready')!({ sender: host.webContents, senderFrame: host.webContents.mainFrame })
}
function controlEvent() { const win = h.windows.at(-1); return { sender: win.webContents, senderFrame: win.webContents.mainFrame } }

describe('原型窗口与 IPC 生命周期', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173')
    h.events.clear(); h.listeners.clear(); h.handlers.clear(); h.windows = []; h.commands = []; h.state = null; h.reply = true
    h.server.mockResolvedValue({ port: 1234, close: h.closeServer })
    h.openDialog.mockResolvedValue({ canceled: false, filePaths: ['/test-audio'] })
    h.scan.mockResolvedValue([{ id: 'new', name: '新音频' }])
    h.saveDialog.mockResolvedValue({ canceled: true })
    h.writeFile.mockResolvedValue(undefined)
  })
  afterEach(async () => {
    h.reply = true
    h.events.get('before-quit')?.({ preventDefault: vi.fn() })
    await flush()
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs()
  })
  it('销毁并重建的只有控制窗口，后台会话与加载次数不变，重连只查询快照', async () => {
    await boot(); ready()
    const host = h.windows[0], oldControl = h.windows[1]
    expect(h.setPath).toHaveBeenCalledWith('userData', join('/tmp/probe-unit-test', 'simplemusic-playback-probe'))
    h.handlers.get('probe:detach')!(controlEvent(), 10)
    expect(oldControl.destroyed).toBe(true)
    expect(host.destroyed).toBe(false)
    expect(h.quit).not.toHaveBeenCalled()
    h.events.get('activate')!()
    h.events.get('second-instance')!()
    expect(h.windows).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(10000)
    expect(h.windows).toHaveLength(3)
    const snapshot = await h.handlers.get('probe:snapshot')!(controlEvent())
    expect(snapshot).toMatchObject({ sessionId: h.state!.sessionId, loadCount: 1, position: 10 })
    expect(h.commands.every(command => command.type === 'observe' || command.type === 'snapshot')).toBe(true)
  })
  it('其他窗口和子 frame 不能调用播放或查询接口', async () => {
    await boot(); ready()
    const host = h.windows[0]
    expect(() => h.handlers.get('probe:command')!({ sender: host.webContents, senderFrame: host.webContents.mainFrame }, { type: 'play' })).toThrow('无效的原型控制入口')
    expect(() => h.handlers.get('probe:snapshot')!({ ...controlEvent(), senderFrame: {} })).toThrow('无效的原型控制入口')
  })
  it('控制窗口销毁后，迟到的文件夹扫描不能替换音频队列', async () => {
    await boot(); ready()
    let finish!: (tracks: any[]) => void
    h.scan.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const loading = h.handlers.get('probe:choose-folder')!(controlEvent())
    await flush()
    h.handlers.get('probe:detach')!(controlEvent(), 10)
    finish([{ id: 'old', name: '旧结果' }])
    expect(await loading).toBe(0)
    expect(h.commands.some(command => command.type === 'replace')).toBe(false)
  })
  it('宿主崩溃进入错误态，不自动创建第二个出声窗口，待处理请求失败', async () => {
    await boot(); ready()
    h.reply = false
    const request = h.handlers.get('probe:command')!(controlEvent(), { type: 'play' })
    const failed = expect(request).rejects.toThrow('音频宿主已退出')
    h.windows[0].webEvents.get('render-process-gone')!()
    await failed
    expect(h.windows[0].destroyed).toBe(true)
    expect(h.windows).toHaveLength(2)
    const report = h.handlers.get('probe:report')!(controlEvent())
    expect(report.latest).toMatchObject({ status: 'paused', error: 'HOST_GONE' })
  })
  it('宿主 reload 不以同会话低版本快照伪装继续播放，而是释放旧输出并要求重启原型', async () => {
    await boot(); ready()
    const host = h.windows[0]
    host.webEvents.get('did-start-navigation')!({ isMainFrame: true, isSameDocument: false })
    expect(host.destroyed).toBe(true)
    expect(h.windows).toHaveLength(2)
    const report = h.handlers.get('probe:report')!(controlEvent())
    expect(report.latest).toMatchObject({ status: 'paused', error: 'HOST_GONE' })
    expect(report.events.some((event: { type: string }) => event.type === 'host-reload-blocked')).toBe(true)
    await expect(h.handlers.get('probe:snapshot')!(controlEvent())).rejects.toThrow('尚未就绪或已退出')
  })
  it('启动服务尚未返回就退出，迟到服务会关闭且不再创建窗口', async () => {
    let finish!: (server: unknown) => void
    h.server.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await boot()
    h.events.get('before-quit')!({ preventDefault: vi.fn() })
    await flush()
    finish({ port: 1234, close: h.closeServer })
    await flush()
    expect(h.closeServer).toHaveBeenCalledOnce()
    expect(h.windows).toHaveLength(0)
  })
  it('内网、凭据和非 HTTP 音频地址不能进入代理测试', async () => {
    await boot(); ready()
    for (const url of ['http://127.0.0.1/audio', 'http://192.168.1.2/audio', 'file:///private/audio', 'https://user:pass@example.com/audio']) {
      expect(() => h.handlers.get('probe:stream')!(controlEvent(), url)).toThrow()
    }
    expect(h.commands.some(command => command.type === 'replace')).toBe(false)
  })
  it('播放节点保留自然结束、错误和已受理定位的证据，普通进度和过期快照不记事件', async () => {
    await boot(); ready()
    const host = h.windows[0]
    const publish = (patch: Partial<ProbeSnapshot>) => h.listeners.get('probe:state')!({ sender: host.webContents, senderFrame: host.webContents.mainFrame }, { ...h.state, ...patch })
    const report = () => h.handlers.get('probe:report')!(controlEvent())
    const initialEvents = report().events.length
    publish({ revision: 2, position: 11 })
    publish({ revision: 0, status: 'paused' })
    expect(report().events).toHaveLength(initialEvents)
    h.state = { ...h.state!, revision: 3, status: 'paused', position: 12 }
    await h.handlers.get('probe:command')!(controlEvent(), { type: 'seek', value: 12 })
    expect(report().events.find((event: { type: string }) => event.type === 'command-seek').snapshot).toMatchObject({ position: 12, status: 'paused' })
    publish({ revision: 4, error: 'MEDIA_ERR_4' })
    publish({ revision: 5, endedCount: 1 })
    expect(report().events.at(-2).snapshot.error).toBe('MEDIA_ERR_4')
    expect(report().events.at(-1).snapshot.endedCount).toBe(1)
  })
  it('播放事件与窗口事件共用 200 条上限，历史节点不随后续状态改变', async () => {
    await boot(); ready()
    h.state = { ...h.state!, revision: 2, position: 12 }
    await h.handlers.get('probe:command')!(controlEvent(), { type: 'seek', value: 12 })
    h.state.position = 20
    const report = () => h.handlers.get('probe:report')!(controlEvent())
    expect(report().events.at(-1).snapshot.position).toBe(12)
    for (let i = 0; i < 205; i++) {
      h.state = { ...h.state!, revision: i + 3, position: i }
      await h.handlers.get('probe:command')!(controlEvent(), { type: 'seek', value: i })
    }
    expect(report().events).toHaveLength(200)
    expect(report().events.at(-1).snapshot.position).toBe(204)
  })
  it('报告采样有上限，导出仅包含白名单状态；写盘失败不能报成功', async () => {
    await boot(); ready()
    await vi.advanceTimersByTimeAsync(1802000)
    expect(h.handlers.get('probe:report')!(controlEvent()).samples).toHaveLength(900)
    const host = h.windows[0]
    h.listeners.get('probe:state')!({ sender: host.webContents, senderFrame: host.webContents.mainFrame }, {
      ...h.state, revision: 2, error: 'MEDIA_ERR_4', secret: 'private-token', current: { ...h.state!.current, url: 'file:///private/audio' },
    })
    h.saveDialog.mockResolvedValue({ canceled: false, filePath: '/test-report.json' })
    expect(await h.handlers.get('probe:export')!(controlEvent())).toBe(true)
    const raw = h.writeFile.mock.calls[0][1] as string
    expect(raw).not.toContain('private-token')
    expect(raw).not.toContain('file:///private')
    expect(JSON.parse(raw).latest.loadCount).toBe(1)
    expect(JSON.parse(raw).events.some((event: { snapshot?: ProbeSnapshot }) => event.snapshot?.error === 'MEDIA_ERR_4')).toBe(true)
    h.writeFile.mockRejectedValueOnce(new Error('disk full'))
    await expect(h.handlers.get('probe:export')!(controlEvent())).rejects.toThrow('报告保存失败')
  })
})
