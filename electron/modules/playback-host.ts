import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getMainWindow, resolveRendererUrl } from './window-manager'
import type { PlaybackHostReply, PlaybackRequest } from '../../src/types/ipc'

const MAX_PENDING = 128
const REQUEST_TIMEOUT = 30000
const ACTION_TIMEOUT = 120000
const MAX_PAYLOAD_SIZE = 8 * 1024 * 1024
let host: BrowserWindow | null = null
let loaded = false
let ready = false
let shuttingDown = false
let hostSession: string | undefined
let revision = -1
const failureListeners = new Set<() => void>()

export function onPlaybackHostFailure(listener: () => void): () => void {
  failureListeners.add(listener)
  return () => { failureListeners.delete(listener) }
}
const pending = new Map<string, {
  owner: Electron.WebContents
  frame: Electron.WebFrameMain
  request: PlaybackRequest
  sent: boolean
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}>()

function matchesEntry(value: string, entry: string): boolean {
  try {
    const actual = new URL(value)
    const expected = new URL(resolveRendererUrl(entry))
    actual.hash = ''
    expected.hash = ''
    return actual.href === expected.href
  } catch { return false }
}

function trusted(event: IpcMainEvent | IpcMainInvokeEvent, win: BrowserWindow | null, entry: string): boolean {
  return !!win && !win.isDestroyed() && event.sender === win.webContents
    && !event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame
    && matchesEntry(event.senderFrame.url, entry)
}

function bounded(value: unknown): boolean {
  try { return JSON.stringify(value).length <= MAX_PAYLOAD_SIZE } catch { return false }
}

export function isPlaybackRequest(value: unknown): value is PlaybackRequest {
  if (!value || typeof value !== 'object' || !bounded(value)) return false
  const request = value as Record<string, unknown>
  switch (request.type) {
    case 'connect': return !!request.storage && typeof request.storage === 'object' && !Array.isArray(request.storage)
      && Object.values(request.storage).every(item => typeof item === 'string')
    case 'action': return typeof request.store === 'string' && request.store.length <= 80
      && typeof request.action === 'string' && request.action.length <= 80 && Array.isArray(request.args)
      && (request.requestId === undefined || (typeof request.requestId === 'string' && request.requestId.length <= 160))
    case 'observe': return typeof request.visible === 'boolean'
      && (request.spectrum === undefined || typeof request.spectrum === 'boolean')
    case 'cancel': return typeof request.requestId === 'string' && request.requestId.length <= 160
    default: return false
  }
}

export function isPlaybackHostEvent(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return trusted(event, host, 'playback-host.html')
}

export function getPlaybackHost(): BrowserWindow | null { return host }
export function isPlaybackHostReady(): boolean { return ready && !!host && !host.isDestroyed() }

export function sendPlaybackEvent(channel: string, payload: unknown): boolean {
  if (!host || host.isDestroyed() || host.webContents.isDestroyed()) return false
  try { host.webContents.send(channel, payload); return true } catch { return false }
}

function dispatch(id: string): void {
  const item = pending.get(id)
  if (!item || item.sent || !loaded || !host || host.isDestroyed()) return
  item.sent = true
  try { host.webContents.send('playback:command', { id, request: item.request }) }
  catch { settle(id, { error: 'PLAYBACK_HOST_GONE' }) }
}

function settle(id: string, result: PlaybackHostReply): void {
  const item = pending.get(id)
  if (!item) return
  pending.delete(id)
  clearTimeout(item.timer)
  if (result.error) item.reject(new Error(result.error))
  else item.resolve(result.value)
}

function loseUi(contents: Electron.WebContents): void {
  for (const [id, item] of pending) {
    if (item.owner !== contents) continue
    if (item.sent) sendPlaybackEvent('playback:command', { id: randomUUID(), request: { type: 'cancel', requestId: item.request.type === 'action' ? item.request.requestId ?? id : id } })
    settle(id, { error: 'PLAYBACK_UI_DISCONNECTED' })
  }
  sendPlaybackEvent('playback:command', { id: randomUUID(), request: { type: 'action', store: 'shortcuts', action: 'setRecording', args: [false] } })
  sendPlaybackEvent('playback:command', { id: randomUUID(), request: { type: 'action', store: 'controls', action: 'cancelLyricsSelection', args: [] } })
  sendPlaybackEvent('playback:command', { id: randomUUID(), request: { type: 'observe', visible: false, spectrum: false } })
}

export function attachPlaybackUi(win: BrowserWindow): void {
  const contents = win.webContents
  contents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) loseUi(contents)
  })
  contents.on('render-process-gone', () => loseUi(contents))
  win.on('closed', () => loseUi(contents))
}

function hostGone(win: BrowserWindow): void {
  if (host !== win) return
  host = null
  loaded = false
  ready = false
  hostSession = undefined
  revision = -1
  for (const id of pending.keys()) settle(id, { error: 'PLAYBACK_HOST_GONE' })
  if (!win.isDestroyed()) win.destroy()
  if (!shuttingDown) {
    failureListeners.forEach(listener => listener())
    const ui = getMainWindow()
    if (ui && !ui.isDestroyed()) ui.webContents.send('playback:snapshot', { type: 'host-error', error: 'PLAYBACK_HOST_GONE' })
  }
}

export function createPlaybackHost(port: number, token: string): BrowserWindow {
  if (host && !host.isDestroyed()) return host
  shuttingDown = false
  loaded = false
  ready = false
  const win = new BrowserWindow({
    width: 1, height: 1, show: false, paintWhenInitiallyHidden: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      partition: 'persist:simplemusic-playback-v1',
      contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
      additionalArguments: ['--simplemusic-playback-host', `--simplemusic-server-port=${port}`, `--simplemusic-server-token=${token}`]
    }
  })
  host = win
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('did-start-loading', () => { if (loaded) hostGone(win) })
  win.webContents.on('did-finish-load', () => {
    if (host !== win) return
    loaded = true
    for (const id of pending.keys()) dispatch(id)
  })
  win.webContents.on('render-process-gone', () => hostGone(win))
  win.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => { if (isMainFrame) hostGone(win) })
  win.on('closed', () => hostGone(win))
  void win.loadURL(resolveRendererUrl('playback-host.html')).catch(() => hostGone(win))
  return win
}

export function closePlaybackHost(): void {
  shuttingDown = true
  if (host) hostGone(host)
}

export function registerPlaybackHostIpc(): void {
  ipcMain.handle('playback:request', (event, request: unknown): Promise<unknown> => {
    if (!trusted(event, getMainWindow(), 'index.html') || !isPlaybackRequest(request)) {
      return Promise.reject(new Error('INVALID_PLAYBACK_REQUEST'))
    }
    if (!host || host.isDestroyed()) return Promise.reject(new Error('PLAYBACK_HOST_GONE'))
    if (pending.size >= MAX_PENDING) return Promise.reject(new Error('PLAYBACK_BUSY'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      pending.set(id, {
        owner: event.sender, frame: event.senderFrame!, request, sent: false, resolve, reject,
        timer: setTimeout(() => {
          sendPlaybackEvent('playback:command', { id: randomUUID(), request: { type: 'cancel', requestId: request.type === 'action' ? request.requestId ?? id : id } })
          settle(id, { error: 'PLAYBACK_REQUEST_TIMEOUT' })
        }, request.type === 'action' ? ACTION_TIMEOUT : REQUEST_TIMEOUT)
      })
      dispatch(id)
    })
  })
  ipcMain.on('playback:reply', (event, payload: unknown) => {
    if (!trusted(event, host, 'playback-host.html') || !payload || typeof payload !== 'object') return
    const { id, result } = payload as { id?: unknown; result?: unknown }
    if (typeof id !== 'string' || !result || typeof result !== 'object') return
    const reply = result as PlaybackHostReply
    if (reply.error !== undefined && typeof reply.error !== 'string') return
    settle(id, reply)
  })
  ipcMain.on('playback:publish', (event, snapshot: unknown) => {
    // 大队列/导航快照来自唯一受信宿主，不套用单次UI命令的8MB限制。
    // 静默丢弃合法快照会制造revision缺口，并让重连永远拿不到完整状态。
    if (!trusted(event, host, 'playback-host.html') || !snapshot || typeof snapshot !== 'object') return
    const ui = getMainWindow()
    const spectrum = snapshot as { type?: unknown; data?: unknown; error?: unknown }
    if (spectrum.type === 'host-error') {
      if (typeof spectrum.error === 'string' && spectrum.error.length <= 1000 && host) hostGone(host)
      return
    }
    if (spectrum.type === 'spectrum') {
      if (spectrum.data instanceof Uint8Array && spectrum.data.length <= 4096 && ready && ui && !ui.isDestroyed()) {
        ui.webContents.send('playback:snapshot', snapshot)
      }
      return
    }
    const value = snapshot as { session?: unknown; revision?: unknown; stores?: unknown }
    if (typeof value.session !== 'string' || value.session.length > 160
      || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
      || !value.stores || typeof value.stores !== 'object' || Array.isArray(value.stores)
      || (hostSession !== undefined && value.session !== hostSession) || (value.revision as number) <= revision) return
    hostSession = value.session
    revision = value.revision as number
    ready = true
    if (ui && !ui.isDestroyed()) ui.webContents.send('playback:snapshot', snapshot)
  })
}
