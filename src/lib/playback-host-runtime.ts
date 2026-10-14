import { playbackStores, remoteActions } from './playback-shared-stores'
import { startPlaybackRuntime } from './playback-runtime'
import { providerAccountSession } from './provider-account-session'
import { usePlayerStore } from '../stores/player'
import { useGameModeStore } from '../stores/game-mode'
import { appleAudioSpectrum } from './apple-audio-spectrum'
import { setPlaybackSpectrumRequested, setPlaybackShortcutBlocked } from './playback-host-observation'
import type { PlaybackRequest } from '../types/ipc'

const session = crypto.randomUUID()
let revision = 0
let observed = false
let spectrumUntil = 0
let spectrumTimer: ReturnType<typeof setInterval> | undefined
let publishTimer: ReturnType<typeof setTimeout> | undefined
let stopHost: (() => void) | undefined
const sent = new Map<string, Record<string, unknown>>()
const cancellable = new Map<string, AbortController>()
let sentAccounts: Record<string, number> = {}

function snapshotValue(store: string, key: string, value: unknown): unknown {
  // 下载控制器必须始终留在宿主；UI只需要任务的展示字段。
  if (store === 'downloads' && key === 'jobs') {
    return (value as Array<{ controller: AbortController }>).map(({ controller: _controller, ...job }) => job)
  }
  return value
}

export function takePlaybackSnapshot(full = false) {
  const stores: Record<string, Record<string, unknown>> = {}
  const accountSessions = { netease: providerAccountSession('netease'), qq: providerAccountSession('qq'), apple: providerAccountSession('apple') }
  const accountsChanged = Object.entries(accountSessions).some(([source, epoch]) => sentAccounts[source] !== epoch)
  for (const [name, store] of Object.entries(playbackStores)) {
    const state = store.getState()
    const previous = sent.get(name)
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === 'function') continue
      if (full || !previous || previous[key] !== value || (accountsChanged && name === 'providers' && key === 'byId')) patch[key] = snapshotValue(name, key, value)
    }
    if (Object.keys(patch).length) stores[name] = patch
    sent.set(name, state)
  }
  sentAccounts = accountSessions
  return {
    session, revision: ++revision, full, stores,
    accountSessions,
  }
}

function publish(full = false): void {
  if (publishTimer !== undefined) clearTimeout(publishTimer)
  publishTimer = undefined
  window.desktop!.publishPlayback(takePlaybackSnapshot(full))
}

function schedulePublish(): void {
  if (!observed || publishTimer !== undefined) return
  publishTimer = setTimeout(() => publish(), 100)
}

function stopSpectrum(): void {
  spectrumUntil = 0
  setPlaybackSpectrumRequested(false)
  if (spectrumTimer !== undefined) clearInterval(spectrumTimer)
  spectrumTimer = undefined
  appleAudioSpectrum.stop()
}

function observe(visible: boolean, spectrum = false): void {
  const previouslyObserved = observed
  observed = visible
  if (!visible) setPlaybackShortcutBlocked(false)
  if (!visible && publishTimer !== undefined) {
    clearTimeout(publishTimer)
    publishTimer = undefined
  }
  if (visible && !previouslyObserved) publish(true)
  if (!visible || !spectrum || useGameModeStore.getState().enabled) {
    stopSpectrum()
    return
  }
  spectrumUntil = performance.now() + 2000
  setPlaybackSpectrumRequested(true)
  if (spectrumTimer !== undefined) return
  if (usePlayerStore.getState().playbackTransport === 'musickit') {
    void window.desktop?.startAppleAudioCapture().catch(() => {})
  }
  spectrumTimer = setInterval(() => {
    if (!observed || performance.now() > spectrumUntil || useGameModeStore.getState().enabled) {
      stopSpectrum()
      return
    }
    window.desktop!.publishPlayback({ type: 'spectrum', data: usePlayerStore.getState()._frequencyData() })
  }, 33)
}

/** 只顺序调用动作，不等待慢网络完成才受理 pause/新切歌。 */
export async function handlePlaybackRequest(request: PlaybackRequest): Promise<unknown> {
  if (request.type === 'connect') {
    observed = true
    const snapshot = takePlaybackSnapshot(true)
    window.desktop!.publishPlayback(snapshot)
    return snapshot
  }
  if (request.type === 'observe') {
    observe(request.visible, request.spectrum)
    return
  }
  if (request.type === 'cancel') {
    cancellable.get(request.requestId)?.abort()
    return
  }
  if (request.type !== 'action' || !Object.hasOwn(remoteActions, request.store)
    || !remoteActions[request.store].includes(request.action) || !Array.isArray(request.args)) {
    throw new Error('不支持的播放命令')
  }
  const action = playbackStores[request.store].getState()[request.action]
  if (typeof action !== 'function') throw new Error('播放命令不可用')
  const args = [...request.args]
  let controller: AbortController | undefined
  if (request.requestId && ((request.store === 'downloads' && request.action === 'saveMany')
    || (request.store === 'apple' && request.action === 'refresh'))) {
    controller = new AbortController()
    cancellable.set(request.requestId, controller)
    if (request.store === 'downloads') args[1] = controller.signal
    else args[0] = controller.signal
  }
  try {
    const result = action(...args)
    if (observed) publish()
    if (request.store === 'downloads' && request.action === 'save') {
      // 下载任务由 jobs 持有；IPC 返回受理，避免长下载占着命令回执直到超时。
      void Promise.resolve(result).catch(() => {})
      return
    }
    const value = await result
    if (observed) publish()
    return value
  } finally {
    if (request.requestId && cancellable.get(request.requestId) === controller) cancellable.delete(request.requestId)
  }
}

export function startPlaybackHost(): () => void {
  if (stopHost) return stopHost
  const stopRuntime = startPlaybackRuntime()
  const subscriptions = Object.values(playbackStores).map(store => store.subscribe(schedulePublish))
  const stopGame = useGameModeStore.subscribe(state => { if (state.enabled) stopSpectrum() })
  const capture = () => { if (observed && spectrumUntil > performance.now()) appleAudioSpectrum.start() }
  window.addEventListener('simplemusic:apple-audio-capture', capture)
  publish(true)
  stopHost = () => {
    observed = false
    if (publishTimer !== undefined) clearTimeout(publishTimer)
    stopSpectrum()
    for (const controller of cancellable.values()) controller.abort()
    cancellable.clear()
    subscriptions.forEach(stop => stop())
    stopGame()
    window.removeEventListener('simplemusic:apple-audio-capture', capture)
    stopRuntime()
  }
  window.addEventListener('unload', stopHost, { once: true })
  return stopHost
}
