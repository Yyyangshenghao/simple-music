import { create } from 'zustand'
import type { Track } from '../../types/domain'
import { isKaraokeModelId, sameKaraokeTrack, type Accompaniment, type KaraokeLibrary, type KaraokeModelId, type KaraokePort, type KaraokeProgress, type KaraokeResources } from '../../types/karaoke'

export const KARAOKE_QUEUE_KEY = 'simplemusic-karaoke-queue-v1'
/** 伴奏 ID → 最近一次播放时间（ms），供点按麦克风时优先选最近播放的版本。 */
export const KARAOKE_PLAYED_KEY = 'simplemusic-karaoke-played-v1'
const MAX_JOBS = 200
const MAX_PLAYED = 500
export type KaraokeJobPhase = 'queued' | 'waiting-memory' | 'resolving' | KaraokeProgress['phase'] | 'failed'
export interface KaraokeJob {
  id: string
  track: Track
  model: KaraokeModelId
  directory: string
  phase: KaraokeJobPhase
  progress: number
  addedAt?: number
  startedAt?: number
  error?: string
}
export interface RecentKaraokeJob {
  jobId: string
  accompanimentId: string
  track: Track
  model: KaraokeModelId
  at: number
}
export interface KaraokeQueueState {
  items: Accompaniment[]
  jobs: KaraokeJob[]
  recent: RecentKaraokeJob[]
  directory: string
  directoryNotice: string
  error: string
  paused: boolean
  loaded: boolean
  played: Record<string, number>
  load(): Promise<void>
  enqueue(track: Track, model: KaraokeModelId): Promise<void>
  cancel(id: string): void
  cancelWaiting(): void
  retry(id: string): void
  setPaused(value: boolean): void
  setDirectory(directory: string): Promise<void>
  remove(id: string): Promise<void>
  clearRecent(): void
  markPlayed(id: string): void
}
export interface KaraokeQueueDependencies {
  port: KaraokePort
  library(): Promise<KaraokeLibrary>
  resources(model: KaraokeModelId, duration: number, signal: AbortSignal): Promise<KaraokeResources>
  resolve(track: Track, signal: AbortSignal): Promise<{ key: string; src: string }>
  save(job: KaraokeJob, key: string): Promise<Accompaniment>
  directory(path: string): Promise<void>
  remove(item: Accompaniment): Promise<void>
  storage(): Pick<Storage, 'getItem' | 'setItem'>
}

export const karaokeTrackKey = (track: Track) => `${track.source}:${String(track.mid ?? track.id)}`
const withoutUrl = (track: Track): Track => { const { url: _url, ...rest } = track; return rest }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** 只存任务元数据；控制器和推理资源留在宿主闭包，切歌不参与任务生命周期。 */
export function createKaraokeQueue(deps: KaraokeQueueDependencies) {
  let running = false
  let active: { id: string; controller: AbortController } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let loadVersion = 0
  let unreadable = false
  let loadPromise: Promise<void> | null = null
  const store = create<KaraokeQueueState>((set, get) => {
    const update = (id: string, patch: Partial<KaraokeJob>) => set(state => ({ jobs: state.jobs.map(job => job.id === id ? { ...job, ...patch } : job) }))

    function complete(job: KaraokeJob, item: Accompaniment): void {
      set(state => ({
        jobs: state.jobs.filter(entry => entry.id !== job.id),
        recent: [{ jobId: job.id, accompanimentId: item.id, track: job.track, model: job.model, at: Date.now() },
          ...state.recent.filter(entry => entry.accompanimentId !== item.id)].slice(0, 50),
      }))
    }

    function persist(): void {
      if (unreadable) return
      try {
        deps.storage().setItem(KARAOKE_QUEUE_KEY, JSON.stringify({ version: 1, jobs: get().jobs.map(job => ({ ...job, track: withoutUrl(job.track) })) }))
      } catch { set({ error: '生成队列保存失败，退出后可能需要重新添加任务' }) }
    }

    function persistPlayed(played: Record<string, number>): void {
      try { deps.storage().setItem(KARAOKE_PLAYED_KEY, JSON.stringify(played)) } catch { /* 播放记录只影响默认选择，写失败不打扰用户 */ }
    }

    async function pump(): Promise<void> {
      if (!running || active || get().paused || unreadable) return
      const job = get().jobs.find(job => job.phase === 'queued' || job.phase === 'waiting-memory')
      if (!job) return
      const current = { id: job.id, controller: new AbortController() }
      active = current
      const signal = current.controller.signal
      let waiting = false
      try {
        // 上次退出或回执丢失时，文件可能已保存成功；先查成品，避免重复推理。
        await get().load()
        signal.throwIfAborted()
        const existing = get().items.find(item => item.available && item.model === job.model && sameKaraokeTrack(item.track, job.track))
        if (existing) {
          complete(job, existing)
          persist()
          return
        }
        if (get().paused) return
        const resources = await deps.resources(job.model, job.track.duration ?? 0, signal)
        signal.throwIfAborted()
        if (!resources.canStart) {
          waiting = true
          update(job.id, { phase: 'waiting-memory', progress: 0, error: '当前内存不足，等待释放后继续' })
          return
        }
        if (get().paused) return
        update(job.id, { phase: 'resolving', progress: 0, error: undefined, startedAt: Date.now() })
        const source = await deps.resolve(job.track, signal)
        signal.throwIfAborted()
        if (!await deps.port.supported()) throw new Error('当前设备不支持伴奏生成，需要支持 WebGPU 的显卡')
        signal.throwIfAborted()
        await deps.port.separate(job.model, source.key, source.src, progress => {
          if (!signal.aborted && running) update(job.id, progress)
        }, signal)
        signal.throwIfAborted()
        update(job.id, { phase: 'saving', progress: 0 })
        const saved = await deps.save(job, source.key)
        if (!running) return
        ++loadVersion
        set(state => ({ items: [saved, ...state.items.filter(item => item.id !== saved.id)] }))
        complete(job, saved)
        persist()
      } catch (error) {
        if (!signal.aborted && running) {
          update(job.id, { phase: 'failed', progress: 0, error: message(error) })
          persist()
        }
      } finally {
        // 低内存等待没有创建推理资源；其他终态都结束辅助进程，归还会话与显存。
        if (!waiting) deps.port.release()
        if (active === current) active = null
        if (running && !get().paused) timer = setTimeout(() => void pump(), waiting ? 5000 : 500)
      }
    }

    return {
      items: [], jobs: [], recent: [], directory: '', directoryNotice: '', error: '', paused: false, loaded: false, played: {},
      load() {
        if (loadPromise) return loadPromise
        const version = loadVersion
        loadPromise = deps.library().then(library => {
          if (version === loadVersion) set({ items: library.items, directory: library.directory, directoryNotice: library.directoryNotice ?? '', loaded: true, ...(!unreadable ? { error: '' } : {}) })
        }).catch(error => { set({ loaded: true, error: message(error) }); throw error })
          .finally(() => { loadPromise = null })
        return loadPromise
      },
      async enqueue(track, model) {
        if (unreadable) throw new Error('旧生成队列无法读取，请先恢复存档后重试')
        if (!track || !['netease', 'qq', 'local'].includes(track.source) || String(track.id).startsWith('karaoke:') || !isKaraokeModelId(model)) throw new Error('这首歌无法生成伴奏')
        await get().load()
        if (get().items.some(item => item.available && sameKaraokeTrack(item.track, track) && item.model === model)
          || get().jobs.some(job => sameKaraokeTrack(job.track, track) && job.model === model)) return
        if (get().jobs.length >= MAX_JOBS) throw new Error('生成队列已满，请先处理已有任务')
        const job: KaraokeJob = { id: crypto.randomUUID(), track: withoutUrl(track), model, directory: get().directory, phase: 'queued', progress: 0, addedAt: Date.now() }
        set(state => ({ jobs: [...state.jobs, job] }))
        persist()
        void pump()
      },
      cancel(id) {
        // 正在发布完整文件时不再取消，避免文件已写成功却显示取消。
        if (get().jobs.find(job => job.id === id)?.phase === 'saving') return
        if (active?.id === id) { active.controller.abort(); deps.port.release() }
        set(state => ({ jobs: state.jobs.filter(job => job.id !== id) }))
        persist()
      },
      retry(id) {
        if (active?.id === id) return
        update(id, { phase: 'queued', progress: 0, error: undefined, addedAt: Date.now(), startedAt: undefined })
        persist()
        void pump()
      },
      cancelWaiting() {
        const waiting = get().jobs.filter(job => job.phase === 'queued' || job.phase === 'waiting-memory')
        if (active && waiting.some(job => job.id === active?.id)) { active.controller.abort(); deps.port.release() }
        set(state => ({ jobs: state.jobs.filter(job => !waiting.includes(job)) }))
        persist()
      },
      setPaused(value) {
        set({ paused: value })
        if (!value) void pump()
      },
      async setDirectory(directory) {
        await deps.directory(directory)
        ++loadVersion
        set({ directory, directoryNotice: '' })
        // 在途读取属于旧目录；等它丢弃结果后，再查询新目录，不能复用旧 promise。
        await loadPromise?.catch(() => {})
        await get().load()
      },
      async remove(id) {
        const item = get().items.find(item => item.id === id)
        if (!item) return
        if (get().jobs.some(job => job.model === item.model && sameKaraokeTrack(job.track, item.track))) throw new Error('这首伴奏正在生成，请完成或取消任务后再删除')
        await deps.remove(item)
        ++loadVersion
        set(state => ({ items: state.items.filter(item => item.id !== id), recent: state.recent.filter(item => item.accompanimentId !== id) }))
        if (id in get().played) {
          const { [id]: _removed, ...played } = get().played
          set({ played })
          persistPlayed(played)
        }
      },
      clearRecent() { set({ recent: [] }) },
      markPlayed(id) {
        const entries = Object.entries({ ...get().played, [id]: Date.now() })
          .sort((a, b) => b[1] - a[1]).slice(0, MAX_PLAYED)
        const played = Object.fromEntries(entries)
        set({ played })
        persistPlayed(played)
      },
    }
  })

  function start(): () => void {
    if (running) return stop
    running = true
    try {
      const raw = deps.storage().getItem(KARAOKE_PLAYED_KEY)
      const saved: unknown = raw ? JSON.parse(raw) : null
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        store.setState({ played: Object.fromEntries(Object.entries(saved).filter(([key, at]) => /^[a-f0-9]{40}$/.test(key) && typeof at === 'number')) })
      }
    } catch { /* 记录损坏时按未播放处理 */ }
    try {
      const raw = deps.storage().getItem(KARAOKE_QUEUE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved.version !== 1 || !Array.isArray(saved.jobs) || saved.jobs.length > MAX_JOBS
          || !saved.jobs.every((job: KaraokeJob) => job && typeof job.id === 'string' && isKaraokeModelId(job.model) && typeof job.directory === 'string'
            && job.track && ['netease', 'qq', 'local'].includes(job.track.source) && typeof job.track.name === 'string' && Array.isArray(job.track.artists))) throw new Error('INVALID_QUEUE')
        const jobs: KaraokeJob[] = saved.jobs.map((job: KaraokeJob) => ({ ...job, track: withoutUrl(job.track), phase: job.phase === 'failed' ? 'failed' : 'queued', progress: 0 }))
        store.setState({ jobs, paused: jobs.length > 0 })
      }
    } catch { unreadable = true; store.setState({ error: '生成队列存档无法读取，原记录已保留，请修复后重启应用', paused: true }) }
    void store.getState().load().catch(() => {})
    return stop
  }

  function stop(): void {
    running = false
    clearTimeout(timer)
    // 已存下的任务保持原样；下次启动恢复为暂停，避免突然占用内存。
    active?.controller.abort()
    deps.port.release()
  }

  return { store, start }
}
