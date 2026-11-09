import { usePlaylistStore } from '../stores/playlist'
import { isProviderParticipating } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import { queueDisplayOrder } from './queue-display'
import { getQishuiListeningTracks } from './qishui-music-service'

/**
 * 汽水听歌模式：队列快播完时向汽水要下一批，只要还在这个模式就一直续上。
 * 游客曲库有限，新批次常与队列重复，所以同时丢掉较早播过的歌，让它们之后还能再回来。
 */
const CONTEXT_PREFIX = 'qishui-radio:'
const REFILL_WHEN_LEFT = 3
const HISTORY_KEEP = 30
const RETRY_DELAY_MS = 30_000

export function qishuiRadioContext(mode: string): string {
  return `${CONTEXT_PREFIX}${mode}`
}

export function qishuiRadioMode(contextId: unknown): string | null {
  return typeof contextId === 'string' && contextId.startsWith(CONTEXT_PREFIX) ? contextId.slice(CONTEXT_PREFIX.length) : null
}

function queuePosition() {
  const { queue, queueIndex, shuffleOrder } = usePlaylistStore.getState()
  return queueDisplayOrder(queue.length, queueIndex, shuffleOrder, useSettingsStore.getState().playMode)
}

function trimHistory(): void {
  const { indices, currentDisplayIndex } = queuePosition()
  const expired = indices.slice(0, Math.max(0, currentDisplayIndex - HISTORY_KEEP)).sort((a, b) => b - a)
  for (const index of expired) usePlaylistStore.getState().removeQueueItem(index)
}

/** 在播放宿主内运行：队列只在这里变动，主窗口经远程动作转发。 */
export function initQishuiRadio(now: () => number = Date.now): () => void {
  let loadingContext: string | null = null
  let retryAt = 0
  let stopped = false

  async function refill(mode: string, context: string) {
    loadingContext = context
    try {
      const tracks = await getQishuiListeningTracks(mode)
      if (stopped || usePlaylistStore.getState().queueContextId !== context) return
      trimHistory()
      const added = await usePlaylistStore.getState().addManyToQueue(tracks)
      if (!added) retryAt = now() + RETRY_DELAY_MS
    } catch {
      // 补不上时队列按原样循环，稍后再试，不打断正在播放的歌。
      retryAt = now() + RETRY_DELAY_MS
    } finally {
      loadingContext = null
    }
  }

  const unsubscribe = usePlaylistStore.subscribe((state, previous) => {
    if (state.queueIndex === previous.queueIndex && state.queueContextId === previous.queueContextId) return
    if (state.queueContextId !== previous.queueContextId) retryAt = 0
    const mode = qishuiRadioMode(state.queueContextId)
    if (!mode || state.queueIndex < 0 || loadingContext === state.queueContextId || now() < retryAt) return
    if (!isProviderParticipating('qishui')) return
    const { indices, currentDisplayIndex } = queuePosition()
    if (indices.length - currentDisplayIndex - 1 > REFILL_WHEN_LEFT) return
    void refill(mode, state.queueContextId as string)
  })

  return () => {
    stopped = true
    unsubscribe()
  }
}
