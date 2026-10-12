import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startServer } from '../../server/index'
import { addLocalFolder } from '../../server/lib/local-library'
import { isSafeUpstreamUrl } from '../../server/lib/security'
import { isProbeCommand, isProbeSender, readProbeSnapshot } from './guards'
import type { ProbeHostCommand, ProbeReport, ProbeSnapshot } from '../../src/types/ipc'

// 独立进程入口，不导入正式 main、player store、Apple 会话或用户设置。
const profile = join(app.getPath('temp'), 'simplemusic-playback-probe')
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.setName('Simple Music Playback Probe')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const sessionId = randomUUID()
const startedAt = new Date().toISOString()
const started = performance.now()
let host: BrowserWindow | null = null
let control: BrowserWindow | null = null
let hostReady = false
let hostFailed = false
let closing = false
let quitReady = false
let latest: ProbeSnapshot | null = null
let commandId = 0
let selectionRevision = 0
let detachTimer: ReturnType<typeof setTimeout> | undefined
let metricsTimer: ReturnType<typeof setInterval> | undefined
let server: Awaited<ReturnType<typeof startServer>> | undefined
const pending = new Map<number, { type: ProbeHostCommand['type']; resolve(snapshot: ProbeSnapshot): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
const samples: ProbeReport['samples'] = []
const events: ProbeReport['events'] = []

function entry(page: 'host' | 'control'): string {
  const base = process.env.ELECTRON_RENDERER_URL
  return base ? new URL(`${page}.html`, base.endsWith('/') ? base : `${base}/`).href
    : pathToFileURL(join(import.meta.dirname, `../renderer/${page}.html`)).href
}
function record(type: string, snapshot?: ProbeSnapshot) {
  events.push({ elapsedMs: Math.round(performance.now() - started), type,
    ...(snapshot ? { snapshot: { ...snapshot, current: snapshot.current ? { ...snapshot.current } : null } } : {}),
  })
  if (events.length > 200) events.shift()
}
function accept(value: unknown): ProbeSnapshot | null {
  const snapshot = readProbeSnapshot(value, sessionId)
  if (!snapshot || (latest && snapshot.revision < latest.revision)) return null
  // 记录状态节点，不将每秒进度广播扩充成持续日志；快照已经过白名单过滤。
  if (!latest || snapshot.status !== latest.status || snapshot.current?.id !== latest.current?.id
    || snapshot.queueIndex !== latest.queueIndex || snapshot.queueLength !== latest.queueLength
    || snapshot.loadCount !== latest.loadCount || snapshot.endedCount !== latest.endedCount
    || snapshot.sleepAt !== latest.sleepAt || snapshot.error !== latest.error || snapshot.deviceChanges !== latest.deviceChanges) {
    record('playback-state', snapshot)
  }
  latest = snapshot
  if (control && !control.isDestroyed()) control.webContents.send('probe:state', snapshot)
  return snapshot
}
function request(command: ProbeHostCommand): Promise<ProbeSnapshot> {
  if (!hostReady || !host || host.isDestroyed()) return Promise.reject(new Error('音频宿主尚未就绪或已退出'))
  if (pending.size >= 32) return Promise.reject(new Error('命令过多，请稍后重试'))
  const id = ++commandId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); record('command-timeout'); reject(new Error('音频宿主响应超时')) }, 5000)
    pending.set(id, { type: command.type, resolve, reject, timer })
    host!.webContents.send('probe:execute', { id, command })
  })
}
function requireControl(event: Electron.IpcMainInvokeEvent) {
  if (!isProbeSender(event, control, entry('control')) || closing) throw new Error('无效的原型控制入口')
}
function lockWindow(win: BrowserWindow, page: 'host' | 'control') {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => { if (url !== entry(page)) event.preventDefault() })
  win.webContents.on('will-redirect', event => event.preventDefault())
  win.webContents.session.setPermissionCheckHandler(() => false)
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}
function failHost() {
  if (closing || hostFailed) return
  hostFailed = true
  hostReady = false
  record('host-gone')
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('音频宿主已退出')) }
  pending.clear()
  if (latest) accept({ ...latest, revision: latest.revision + 1, status: 'paused', error: 'HOST_GONE' })
  // 不自动重建出声会话；先销毁旧宿主，避免双路输出。
  if (host && !host.isDestroyed()) host.destroy()
}
function createControl() {
  if (closing) return
  clearTimeout(detachTimer)
  detachTimer = undefined
  if (control && !control.isDestroyed()) { control.show(); control.focus(); return }
  const win = new BrowserWindow({
    title: 'Simple Music · 音频宿主验证', width: 980, height: 760, minWidth: 740, minHeight: 600,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'probe-control', additionalArguments: ['--probe-role=control'] },
  })
  control = win
  lockWindow(win, 'control')
  record('control-created')
  void win.loadURL(entry('control')).catch(() => { if (!closing) record('control-load-failed') })
  if (hostReady) void request({ type: 'observe', enabled: true }).catch(() => {})
  win.on('closed', () => {
    if (control === win) control = null
    ++selectionRevision
    record('control-destroyed')
    if (hostReady) void request({ type: 'observe', enabled: false }).catch(() => {})
    // 普通关闭结束原型；只有明确的限时销毁实验保留后台。
    if (!closing && !detachTimer) app.quit()
  })
}
function report(): ProbeReport {
  return JSON.parse(JSON.stringify({ schema: 1, startedAt, runtime: {
    electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch, build: 'development',
  }, notes: [
    '开发原型数据，不能作为正式游戏模式的资源收益或帧率结论。',
    '每 2 秒调用一次 app.getAppMetrics；CPU 为 Electron 返回的区间百分比。',
    'workingSetKiB/privateKiB 单位为 KiB；工作集相加可能重复计入共享页。',
    '最多保留最近 900 个样本和 200 个生命周期/播放事件；播放节点仅保存白名单快照，不逐秒记录进度。未测 GPU 利用率及游戏帧时间。',
  ], latest, samples, events })) as ProbeReport
}
function registerIpc() {
  ipcMain.on('probe:ready', event => {
    if (!isProbeSender(event, host, entry('host')) || closing || hostFailed) return
    hostReady = true
    record('host-ready')
    void request({ type: 'observe', enabled: !!control }).catch(() => {})
  })
  ipcMain.on('probe:state', (event, value) => { if (isProbeSender(event, host, entry('host')) && !hostFailed) accept(value) })
  ipcMain.on('probe:reply', (event, packet) => {
    if (!isProbeSender(event, host, entry('host')) || !packet || !Number.isSafeInteger(packet.id)) return
    const item = pending.get(packet.id)
    if (!item) return
    pending.delete(packet.id)
    clearTimeout(item.timer)
    const snapshot = accept(packet.snapshot)
    if (snapshot) {
      if (item.type !== 'snapshot' && item.type !== 'observe') record(`command-${item.type}`, snapshot)
      item.resolve(snapshot)
    }
    else item.reject(new Error('无效或过期的播放快照'))
  })
  ipcMain.handle('probe:snapshot', event => { requireControl(event); return request({ type: 'snapshot' }) })
  ipcMain.handle('probe:command', (event, command: unknown) => {
    requireControl(event)
    if (!isProbeCommand(command)) throw new Error('无效的播放命令')
    return request(command)
  })
  ipcMain.handle('probe:choose-folder', async event => {
    requireControl(event)
    const revision = ++selectionRevision
    const win = control!
    const result = await dialog.showOpenDialog(win, { title: '选择原型测试音乐文件夹', properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return 0
    let tracks: Awaited<ReturnType<typeof addLocalFolder>>
    try { tracks = await addLocalFolder(profile, result.filePaths[0]) }
    catch { throw new Error('读取测试文件夹失败') }
    if (closing || revision !== selectionRevision || control !== win || win.isDestroyed()) return 0
    const queue = tracks.map(track => ({
      id: track.id, label: track.name, kind: 'local' as const,
      url: `http://127.0.0.1:${server!.port}/api/local/audio?id=${encodeURIComponent(track.id)}&token=${token}`,
    }))
    await request({ type: 'replace', items: queue })
    return queue.length
  })
  ipcMain.handle('probe:stream', (event, raw: unknown) => {
    requireControl(event)
    if (typeof raw !== 'string' || raw.length > 8192 || !isSafeUpstreamUrl(raw)) throw new Error('请输入公开 HTTP(S) 音频地址，不能使用本地或内网地址')
    const url = new URL(raw)
    if (url.username || url.password) throw new Error('音频地址不能包含账号或密码')
    ++selectionRevision
    return request({ type: 'replace', items: [{ id: randomUUID(), label: '代理流测试', kind: 'proxy', url: raw }] })
  })
  ipcMain.handle('probe:detach', (event, seconds: unknown) => {
    requireControl(event)
    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 120) throw new Error('销毁实验时长应为 1–120 秒')
    clearTimeout(detachTimer)
    detachTimer = setTimeout(createControl, seconds * 1000)
    control!.destroy()
  })
  ipcMain.handle('probe:report', event => { requireControl(event); return report() })
  ipcMain.handle('probe:export', async event => {
    requireControl(event)
    const result = await dialog.showSaveDialog(control!, { title: '保存原型验证报告', defaultPath: 'playback-probe.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return false
    try { await writeFile(result.filePath, JSON.stringify(report(), null, 2)); return true }
    catch { throw new Error('报告保存失败') }
  })
  ipcMain.handle('probe:quit', event => { requireControl(event); setTimeout(() => app.quit(), 0) })
}

const token = randomBytes(32).toString('hex')
if (!app.requestSingleInstanceLock()) app.quit()
else {
  // 限时销毁实验必须保持窗口不存在，系统激活或第二实例不能提前结束实验。
  app.on('second-instance', () => { if (!detachTimer) createControl() })
  app.on('activate', () => { if (host && !detachTimer) createControl() })
  void app.whenReady().then(async () => {
    if (closing) return
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: '原型', submenu: [{ role: 'quit', label: '退出原型' }] }, { role: 'editMenu' }]))
    registerIpc()
    server = await startServer({ userDataDir: profile, token, allowLocalhostOrigins: !app.isPackaged })
    if (closing) { server.close(); return }
    host = new BrowserWindow({ show: false, paintWhenInitiallyHidden: false, width: 1, height: 1, webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, partition: 'probe-audio', additionalArguments: ['--probe-role=host', `--probe-session=${sessionId}`, `--probe-port=${server.port}`, `--probe-token=${token}`],
    } })
    lockWindow(host, 'host')
    host.webContents.on('did-start-navigation', details => {
      if (hostReady && details.isMainFrame && !details.isSameDocument) { record('host-reload-blocked'); failHost() }
    })
    host.webContents.on('render-process-gone', failHost)
    host.on('closed', () => { failHost(); host = null })
    await host.loadURL(entry('host'))
    if (closing) return
    createControl()
    app.getAppMetrics() // 首次调用预热区间，不记为 0 CPU 样本。
    metricsTimer = setInterval(() => {
      samples.push({ elapsedMs: Math.round(performance.now() - started), controlOpen: !!control && !control.isDestroyed(), hostAlive: hostReady,
        status: latest?.status ?? 'idle', loadCount: latest?.loadCount ?? 0, endedCount: latest?.endedCount ?? 0,
        processes: app.getAppMetrics().map(metric => ({ pid: metric.pid, kind: metric.name || metric.type, cpuPercent: metric.cpu.percentCPUUsage, workingSetKiB: metric.memory.workingSetSize, privateKiB: metric.memory.privateBytes })),
      })
      if (samples.length > 900) samples.shift()
    }, 2000)
  }).catch(() => { console.error('Playback probe startup failed'); app.quit() })
  app.on('before-quit', event => {
    if (quitReady) return
    event.preventDefault()
    if (closing) return
    closing = true
    clearTimeout(detachTimer)
    clearInterval(metricsTimer)
    // stop 有超时；宿主无响应时销毁它后退出，不启动替代音频。
    void request({ type: 'stop' }).catch(() => {}).finally(() => {
      host?.destroy()
      control?.destroy()
      server?.close()
      quitReady = true
      app.quit()
    })
  })
}
