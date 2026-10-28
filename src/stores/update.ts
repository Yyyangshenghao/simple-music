import { create } from 'zustand'
import { api } from '../lib/api'

export interface UpdateAsset {
  name: string
  size: number
  downloadUrl: string
  downloadUrls: string[]
}

export interface UpdateRelease {
  tagName: string
  name: string
  version: string
  htmlUrl: string
  downloadUrl: string
  asset?: UpdateAsset | null
  summary: string
  notes: string[]
}

export interface UpdateInfo {
  configured: boolean
  preview: boolean
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string
  release: UpdateRelease
  reason?: string
  error?: string
}

export type DownloadJobStatus = 'queued' | 'downloading' | 'ready' | 'error'

export interface DownloadJob {
  ok: boolean
  id?: string
  status: DownloadJobStatus
  progress: number
  received: number
  total: number
  speedBps: number
  etaSeconds: number
  sourceLabel: string
  message: string
  fileName: string
  filePath: string
  version: string
  error: string
  errorReason: string
}

const DISMISS_KEY = 'simplemusic-update-dismissed-version'
const POLL_INTERVAL_MS = 800
// 开着的应用也要能收到新版本：定时检查间隔、回到前台时的最短补查间隔，以及判断时机的心跳。
// 心跳比较时间差而不是直接 setInterval(6h)，睡眠唤醒后也能按实际经过的时间补查。
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
export const FOCUS_CHECK_MIN_GAP_MS = 60 * 60 * 1000
const AUTO_CHECK_TICK_MS = 30 * 60 * 1000

interface UpdateStore {
  checking: boolean
  checkedAt: number
  info: UpdateInfo | null
  dismissedVersion: string
  job: DownloadJob | null
  downloading: boolean
  installing: boolean
  checkForUpdate(): Promise<void>
  startDownload(): Promise<void>
  installUpdate(): Promise<void>
  dismiss(): void
}

let pollTimer: ReturnType<typeof setTimeout> | null = null
let downloadSession = 0
let lastAttemptAt = 0

function stopPolling(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  checking: false,
  checkedAt: 0,
  info: null,
  dismissedVersion: typeof window !== 'undefined' ? localStorage.getItem(DISMISS_KEY) || '' : '',
  job: null,
  downloading: false,
  installing: false,

  async checkForUpdate() {
    if (get().checking) return
    set({ checking: true })
    lastAttemptAt = Date.now()
    try {
      const info = await api.get<UpdateInfo>('/api/update/latest')
      const { info: previous, downloading, installing } = get()
      // 下载/安装中的版本信息不能被替换；检测失败的兜底结果不能冲掉已显示的新版本提示。
      if (downloading || installing) return
      if (previous?.updateAvailable && !info.updateAvailable && (info.error || info.reason)) return
      set({ info, checkedAt: Date.now() })
    } catch {
      // 检测更新失败静默忽略，不影响正常使用
    } finally {
      set({ checking: false })
    }
  },

  async startDownload() {
    if (get().downloading) return
    const session = ++downloadSession
    stopPolling()
    set({ downloading: true })
    try {
      const job = await api.post<DownloadJob>('/api/update/download')
      if (session !== downloadSession) return
      set({ job })
      if (job.ok && job.status !== 'ready' && job.status !== 'error') {
        const jobId = job.id
        const poll = async () => {
          if (session !== downloadSession) return
          try {
            const next = await api.get<DownloadJob>('/api/update/download/status', { id: jobId })
            if (session !== downloadSession) return
            set({ job: next })
            if (next.status === 'ready' || next.status === 'error') {
              stopPolling()
              set({ downloading: false })
            } else {
              pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
            }
          } catch {
            if (session !== downloadSession) return
            stopPolling()
            set({ downloading: false })
          }
        }
        pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
      } else {
        set({ downloading: false })
      }
    } catch {
      if (session === downloadSession) set({ downloading: false })
    }
  },

  async installUpdate() {
    const filePath = get().job?.filePath
    if (!filePath || get().installing) return
    set({ installing: true })
    try {
      // win32：静默装完自动重启；darwin：弹出 dmg 安装器后应用自行退出，
      // 剩下的拖拽替换由用户在 Finder 里手动完成。两种情况都会导致应用退出，
      // 不需要复位 installing；只有失败才复位让用户能重试。
      const result = await window.desktop?.installUpdate(filePath)
      if (result && !result.ok) set({ installing: false })
    } catch {
      set({ installing: false })
    }
  },

  dismiss() {
    const version = get().info?.latestVersion || ''
    if (typeof window !== 'undefined') localStorage.setItem(DISMISS_KEY, version)
    set({ dismissedVersion: version })
  }
}))

/** 启动时检查一次，之后定时检查，并在窗口回到前台时补查；返回停止函数。 */
export function startUpdateAutoCheck(): () => void {
  const checkIfDue = (gap: number) => {
    if (Date.now() - lastAttemptAt >= gap) void useUpdateStore.getState().checkForUpdate()
  }
  const onForeground = () => {
    if (document.visibilityState === 'visible') checkIfDue(FOCUS_CHECK_MIN_GAP_MS)
  }
  void useUpdateStore.getState().checkForUpdate()
  const tick = setInterval(() => checkIfDue(AUTO_CHECK_INTERVAL_MS), AUTO_CHECK_TICK_MS)
  window.addEventListener('focus', onForeground)
  document.addEventListener('visibilitychange', onForeground)
  return () => {
    clearInterval(tick)
    window.removeEventListener('focus', onForeground)
    document.removeEventListener('visibilitychange', onForeground)
  }
}
