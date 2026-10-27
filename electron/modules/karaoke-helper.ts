import { app, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { isPlaybackHostEvent, sendPlaybackEvent } from './playback-host'
import type { KaraokeHelperEvent, KaraokeHelperRequest } from '../../src/types/ipc'
import { isKaraokeModelId } from '../../src/types/karaoke'
import { karaokeResources } from '../../server/lib/karaoke-resources'

/**
 * K 歌分离进程：WebGPU 推理若跑在本应用的渲染进程里，会和界面合成共用同一个 GPU 进程排队，
 * 分离期间主窗口明显掉帧。这里拉起一个自带 GPU 进程的隐藏实例专门做分离。
 */
export const KARAOKE_HELPER_FLAG = '--simplemusic-karaoke-helper'
export const KARAOKE_HELPER_DATA_ARG = '--simplemusic-karaoke-data='
const MAX_TEXT = 2048
let child: ChildProcess | null = null
let server: { port: number; token: string } | null = null
let pressureTimer: ReturnType<typeof setInterval> | undefined
let closing: Promise<void> | null = null
const jobs = new Set<string>()

const text = (value: unknown, max = MAX_TEXT) => typeof value === 'string' && value.length > 0 && value.length <= max

export function isKaraokeHelperRequest(value: unknown): value is KaraokeHelperRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  switch (request.type) {
    case 'separate': return text(request.id, 80) && isKaraokeModelId(request.model) && text(request.key, 240) && text(request.src)
    case 'cancel': return text(request.id, 80)
    case 'release': return true
    default: return false
  }
}

export function isKaraokeHelperEvent(value: unknown): value is KaraokeHelperEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  if (!text(event.id, 80)) return false
  switch (event.type) {
    case 'progress': return ['model', 'preparing', 'decoding', 'separating', 'saving'].includes(String(event.phase))
      && typeof event.progress === 'number' && Number.isFinite(event.progress) && event.progress >= 0 && event.progress <= 1
    case 'done': return text(event.url)
    case 'error': return typeof event.message === 'string' && event.message.length <= MAX_TEXT
    default: return false
  }
}

function emit(event: KaraokeHelperEvent): void {
  sendPlaybackEvent('karaoke:event', event)
}

function availableMemory(): { total: number; free: number } | null {
  if (typeof process.getSystemMemoryInfo !== 'function') return null
  const memory = process.getSystemMemoryInfo()
  return { total: memory.total * 1024, free: Math.min(memory.total, memory.free + (memory.purgeable ?? 0) + (memory.fileBacked ?? 0)) * 1024 }
}

function ensureChild(): ChildProcess | null {
  if (child) return child
  if (!server) return null
  // 打包后可执行文件自带应用入口；开发时 execPath 是裸 Electron，需要补上应用目录
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), KARAOKE_HELPER_FLAG, `${KARAOKE_HELPER_DATA_ARG}${join(app.getPath('userData'), 'karaoke-helper')}`]
  const created = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  child = created
  created.on('message', (message: unknown) => {
    if (child !== created || !isKaraokeHelperEvent(message)) return
    if (message.type !== 'progress') {
      jobs.delete(message.id)
    }
    emit(message)
    if (!jobs.size) stopKaraokeHelper()
  })
  const gone = () => {
    if (child !== created) return
    child = null
    clearInterval(pressureTimer)
    for (const id of jobs) emit({ type: 'error', id, message: '分离进程异常退出' })
    jobs.clear()
  }
  created.on('exit', gone)
  created.on('error', gone)
  created.send({ type: 'init', port: server.port, token: server.token, userDataDir: app.getPath('userData') })
  pressureTimer = setInterval(() => {
    if ((availableMemory()?.free ?? Infinity) >= 512 * 1024 * 1024) return
    for (const id of jobs) emit({ type: 'error', id, message: '系统内存紧张，已停止生成以释放资源；请稍后重试' })
    stopKaraokeHelper()
  }, 1000)
  pressureTimer.unref?.()
  return created
}

async function handle(request: KaraokeHelperRequest): Promise<void> {
  if (request.type === 'release') {
    stopKaraokeHelper()
    return
  }
  if (request.type === 'cancel') {
    if (jobs.delete(request.id)) {
      emit({ type: 'error', id: request.id, message: '已取消生成', aborted: true })
      if (!jobs.size) stopKaraokeHelper()
    }
    return
  }
  if (jobs.size) return emit({ type: 'error', id: request.id, message: '已有伴奏正在生成，请等待当前任务结束' })
  const memory = availableMemory()
  if (memory && !karaokeResources(request.model, 0, memory).canStart) return emit({ type: 'error', id: request.id, message: '当前内存不足，请释放内存后重试' })
  jobs.add(request.id)
  if (closing) await closing
  if (!jobs.has(request.id)) return
  const target = ensureChild()
  if (!target) {
    jobs.delete(request.id)
    emit({ type: 'error', id: request.id, message: '分离进程不可用' })
    return
  }
  target.send(request)
}

/** 结束分离进程；在途任务由宿主自行中止，不再回报。 */
export function stopKaraokeHelper(): void {
  clearInterval(pressureTimer)
  jobs.clear()
  const target = child
  child = null
  if (target && target.exitCode === null) {
    const stopped = new Promise<void>(resolve => {
      const timer = setTimeout(() => target.kill('SIGKILL'), 3000)
      timer.unref?.()
      const gone = () => { clearTimeout(timer); resolve() }
      target.once('exit', gone)
      target.once('error', gone)
      target.kill()
    })
    closing = stopped
    void stopped.then(() => { if (closing === stopped) closing = null })
  }
}

export function registerKaraokeHelperIpc(port: number, token: string): void {
  server = { port, token }
  ipcMain.on('karaoke:request', (event, request: unknown) => {
    if (!isPlaybackHostEvent(event) || !isKaraokeHelperRequest(request)) return
    return handle(request)
  })
}
