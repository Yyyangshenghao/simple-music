import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WindowCloseBehavior, WindowCloseChoice, WindowCloseState } from '../../src/types/ipc'

let behavior: WindowCloseBehavior = 'ask'
let loaded = false
let nextPromptId = 0
let active: {
  win: BrowserWindow
  isQuitting(): boolean
  ready: boolean
  promptId: number | null
  nativePromptOpen: boolean
} | null = null

function validBehavior(value: unknown): value is WindowCloseBehavior {
  return value === 'ask' || value === 'tray' || value === 'quit'
}

function preferencesPath(): string {
  return join(app.getPath('userData'), 'window-close.json')
}

function loadBehavior(): void {
  if (loaded) return
  loaded = true
  try {
    const value = JSON.parse(readFileSync(preferencesPath(), 'utf8')) as { behavior?: unknown } | null
    if (validBehavior(value?.behavior)) behavior = value.behavior
  } catch {
    // 首次启动或损坏的偏好保留询问，不能静默退出。
  }
}

function saveBehavior(value: WindowCloseBehavior): void {
  const path = preferencesPath()
  const temporary = `${path}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({ behavior: value }), { mode: 0o600 })
    renameSync(temporary, path)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* 临时文件可能尚未创建。 */ }
    throw error
  }
  behavior = value
}

function state(): WindowCloseState {
  return { behavior, promptId: active?.promptId ?? null }
}

function broadcast(): void {
  if (!active?.ready || active.win.isDestroyed()) return
  // 异常渲染进程可能无法接收消息，不能阻止系统兜底执行用户的关闭选择。
  try { active.win.webContents.send('window:close-state-changed', state()) }
  catch (error) { console.error('Window close state delivery failed:', error) }
}

function available(context: NonNullable<typeof active>): boolean {
  return active === context && !context.isQuitting() && !context.win.isDestroyed()
}

function perform(context: NonNullable<typeof active>, action: 'tray' | 'quit'): void {
  if (!available(context)) return
  if (action === 'tray') context.win.hide()
  else app.quit()
}

async function nativePrompt(context: NonNullable<typeof active>): Promise<void> {
  if (context.nativePromptOpen || !available(context)) return
  context.nativePromptOpen = true
  try {
    const { response, checkboxChecked } = await dialog.showMessageBox(context.win, {
      type: 'question',
      title: 'Simple Music',
      message: '关闭窗口后，你希望如何处理？',
      detail: '缩回托盘将继续在后台播放音乐；退出应用将停止播放。可在「设置 → 界面与窗口 → 关闭窗口」修改。',
      buttons: ['缩回托盘', '退出应用', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: '记住这次选择',
      checkboxChecked: false
    })
    if (!available(context) || (response !== 0 && response !== 1)) return
    const action = response === 0 ? 'tray' : 'quit'
    if (checkboxChecked) saveBehavior(action)
    broadcast()
    perform(context, action)
  } catch (error) {
    console.error('Window close confirmation failed:', error)
  } finally {
    context.nativePromptOpen = false
  }
}

export function attachWindowClose(win: BrowserWindow, isQuitting: () => boolean): void {
  loadBehavior()
  const context: NonNullable<typeof active> = { win, isQuitting, ready: false, promptId: null, nativePromptOpen: false }
  active = context
  // 壁纸的 iframe 加载同样会触发 did-start-loading；只有主框架换页才说明界面正在重载。
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) context.ready = false
  })
  win.webContents.on('render-process-gone', () => {
    context.ready = false
    context.promptId = null
  })
  win.on('unresponsive', () => {
    context.ready = false
    if (context.promptId !== null) {
      context.promptId = null
      void nativePrompt(context)
    }
  })
  win.on('responsive', () => { context.ready = true; broadcast() })
  win.on('closed', () => { if (active === context) active = null })
  win.on('close', (event) => {
    if (isQuitting()) return
    event.preventDefault()
    if (context.nativePromptOpen) return
    if (behavior !== 'ask') {
      perform(context, behavior)
      return
    }
    if (!context.ready) {
      context.promptId = null
      void nativePrompt(context)
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (context.promptId !== null) return
    context.promptId = ++nextPromptId
    broadcast()
  })
}

export function isWindowClosePending(win: BrowserWindow | null): boolean {
  return !!active && active.win === win && (active.promptId !== null || active.nativePromptOpen)
}

/** 渲染层先订阅广播再读取；读取同时表示确认框已准备好接收请求。 */
export function getWindowCloseState(): WindowCloseState {
  loadBehavior()
  if (active) active.ready = true
  return state()
}

export function setWindowCloseBehavior(value: WindowCloseBehavior): WindowCloseState {
  if (!validBehavior(value)) throw new Error('Invalid window close behavior')
  loadBehavior()
  saveBehavior(value)
  broadcast()
  return state()
}

export function resolveWindowClose(choice: WindowCloseChoice): WindowCloseState {
  if (!choice || !Number.isSafeInteger(choice.promptId)
    || !['tray', 'quit', 'cancel'].includes(choice.action) || typeof choice.remember !== 'boolean') {
    throw new Error('Invalid window close choice')
  }
  const context = active
  if (!context || !available(context) || context.promptId !== choice.promptId) return state()
  if (choice.action !== 'cancel' && choice.remember) saveBehavior(choice.action)
  context.promptId = null
  broadcast()
  if (choice.action !== 'cancel') perform(context, choice.action)
  return state()
}
