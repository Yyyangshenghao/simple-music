import { create } from 'zustand'
import { usePlayerStore, setStopAfterCurrent } from './player'
import { useToastStore } from './toast'

/**
 * 睡眠定时器:倒计时到点暂停播放;可选「到点后播完当前曲再停」——
 * 到点时若正在播放则不打断,经 player 的 stopAfterCurrent 闸门在自然播完时停下。
 * 纯会话态,不持久化。
 */

export type SleepTimerPhase = 'idle' | 'counting' | 'finishing-track'

interface SleepTimerStore {
  phase: SleepTimerPhase
  /** 到点时间戳(counting 时有效)。 */
  endAt: number | null
  /** 到点后是否播完当前曲再停。 */
  finishTrack: boolean
  /** 剩余秒数,每秒刷新,供 UI 倒计时显示。 */
  remainingSec: number
  start(minutes: number): void
  setFinishTrack(v: boolean): void
  cancel(): void
}

let tickTimer: ReturnType<typeof setInterval> | null = null

function clearTick(): void {
  if (tickTimer != null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

export const useSleepTimerStore = create<SleepTimerStore>((set, get) => {
  function expire(): void {
    clearTick()
    const status = usePlayerStore.getState().status
    // loading 也算「在播」:此刻 pause 会被起播中的 loadTrack 覆盖,挂闸门等播完更稳
    const playing = status === 'playing' || status === 'loading'
    if (get().finishTrack && playing) {
      // 不打断当前曲:挂上播完即停闸门,等自然结束
      set({ phase: 'finishing-track', endAt: null, remainingSec: 0 })
      setStopAfterCurrent(() => {
        set({ phase: 'idle' })
        useToastStore.getState().show('定时关闭:已停止播放')
      })
    } else {
      usePlayerStore.getState().pause()
      set({ phase: 'idle', endAt: null, remainingSec: 0 })
      useToastStore.getState().show('定时关闭:已停止播放')
    }
  }

  return {
    phase: 'idle',
    endAt: null,
    finishTrack: true,
    remainingSec: 0,

    start(minutes) {
      clearTick()
      setStopAfterCurrent(null)
      const endAt = Date.now() + minutes * 60_000
      set({ phase: 'counting', endAt, remainingSec: minutes * 60 })
      tickTimer = setInterval(() => {
        const at = get().endAt
        if (at == null) return
        const remaining = Math.max(0, Math.ceil((at - Date.now()) / 1000))
        if (remaining <= 0) expire()
        else set({ remainingSec: remaining })
      }, 1000)
    },

    setFinishTrack(v) {
      set({ finishTrack: v })
      // 已处于「等播完」阶段时关掉该选项 = 立即停
      if (!v && get().phase === 'finishing-track') {
        setStopAfterCurrent(null)
        usePlayerStore.getState().pause()
        set({ phase: 'idle' })
      }
    },

    cancel() {
      clearTick()
      setStopAfterCurrent(null)
      set({ phase: 'idle', endAt: null, remainingSec: 0 })
    }
  }
})
