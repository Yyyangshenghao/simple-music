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

let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer)
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
    try {
      const info = await api.get<UpdateInfo>('/api/update/latest')
      set({ info, checkedAt: Date.now() })
    } catch {
      // 检测更新失败静默忽略，不影响正常使用
    } finally {
      set({ checking: false })
    }
  },

  async startDownload() {
    if (get().downloading) return
    set({ downloading: true })
    try {
      const job = await api.post<DownloadJob>('/api/update/download')
      set({ job })
      if (job.ok && job.status !== 'ready' && job.status !== 'error') {
        stopPolling()
        pollTimer = setInterval(async () => {
          const current = get().job
          try {
            const next = await api.get<DownloadJob>('/api/update/download/status', { id: current?.id })
            set({ job: next })
            if (next.status === 'ready' || next.status === 'error') {
              stopPolling()
              set({ downloading: false })
            }
          } catch {
            stopPolling()
            set({ downloading: false })
          }
        }, POLL_INTERVAL_MS)
      } else {
        set({ downloading: false })
      }
    } catch {
      set({ downloading: false })
    }
  },

  async installUpdate() {
    const filePath = get().job?.filePath
    if (!filePath || get().installing) return
    set({ installing: true })
    try {
      const result = await window.desktop?.installUpdate(filePath)
      // 成功时应用即将退出重启，不需要复位 installing；只有失败才复位让用户能重试
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
