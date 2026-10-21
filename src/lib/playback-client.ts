import { playbackStores, remoteActions } from './playback-shared-stores'
import { collectPlaybackStorage } from './playback-host-storage'
import { hydrateProviderAccountSessions, providerAccountSession } from './provider-account-session'
import { clearProviderRequestCache } from './provider-request-cache'
import { useWindowStore } from '../stores/window'
import { initProviderAuthFailureSync } from '../stores/provider-auth'
import { PROVIDER_IDS, type ProviderId } from '../providers/types'
import { shouldIgnoreShortcut } from './shortcuts'
import { AppleLyricClock } from './apple-lyric-clock'

interface PlaybackSnapshot {
  session: string
  revision: number
  full: boolean
  stores: Record<string, Record<string, unknown>>
  accountSessions: Record<ProviderId, number>
}

function isSnapshot(value: unknown): value is PlaybackSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as PlaybackSnapshot
  return typeof snapshot.session === 'string' && Number.isSafeInteger(snapshot.revision)
    && snapshot.revision >= 0 && typeof snapshot.full === 'boolean'
    && !!snapshot.stores && typeof snapshot.stores === 'object'
    && !!snapshot.accountSessions && PROVIDER_IDS.every(id => Number.isSafeInteger(snapshot.accountSessions[id]))
}

function connectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/PLAYBACK_HOST_GONE|PLAYBACK_UI_DISCONNECTED/.test(message)) return '播放连接已断开，请重启应用恢复播放'
  if (/PLAYBACK_REQUEST_TIMEOUT/.test(message)) return '播放器响应超时，请稍后重试'
  if (/PLAYBACK_BUSY/.test(message)) return '播放器正在处理较多操作，请稍后重试'
  if (/INVALID_PLAYBACK_REQUEST/.test(message)) return '本次操作数据过大或格式无效，请缩小范围后重试'
  return message
}

/** 主界面仅镜像宿主状态；任何播放器动作都不能在此创建音频引擎。 */
export async function startPlaybackClient(): Promise<() => void> {
  const desktop = window.desktop
  if (!desktop?.playbackRequest || !desktop.onPlaybackSnapshot) throw new Error('独立播放器连接不可用')
  const stores = playbackStores as Record<string, {
    getState(): Record<string, unknown>
    setState(partial: Record<string, unknown>): void
  }>
  const originalActions: Record<string, Record<string, unknown>> = {}
  const showError = stores.toast.getState().show as (message: string) => void
  let stopped = false
  let failed = false
  let connected = false
  let session: string | undefined
  let revision = -1
  let reconnecting: Promise<void> | undefined
  let frequency: Uint8Array = new Uint8Array(0)
  let spectrumUntil = 0
  let observedSpectrum = false
  let observedVisible: boolean | undefined
  let spectrumObservedAt = -Infinity
  let positionReceivedAt = performance.now()
  const appleLyricClock = new AppleLyricClock()
  let shortcutBlocked: boolean | undefined
  const visible = () => !document.hidden && useWindowStore.getState().isVisible
  const request = (payload: Parameters<typeof desktop.playbackRequest>[0]) => desktop.playbackRequest(payload)
  const reportError = (error: unknown) => showError(connectionError(error))
  const syncShortcutBlock = () => {
    if (stopped || !connected || failed) return
    const dialogOpen = !!document.querySelector?.('dialog[open]')
    const blocked = visible() && (dialogOpen
      || (!!document.hasFocus?.() && shouldIgnoreShortcut(document.activeElement)))
    if (blocked === shortcutBlocked) return
    shortcutBlocked = blocked
    void request({ type: 'action', store: 'controls', action: 'setShortcutBlocked', args: [blocked] }).catch(reportError)
  }
  const observe = () => {
    if (stopped || !connected || failed) return
    syncShortcutBlock()
    const uiVisible = visible()
    const spectrum = uiVisible && performance.now() < spectrumUntil
    if (observedVisible === uiVisible && observedSpectrum === spectrum
      && (!spectrum || performance.now() - spectrumObservedAt < 750)) return
    observedVisible = uiVisible
    observedSpectrum = spectrum
    if (spectrum) spectrumObservedAt = performance.now()
    if (!spectrum) frequency = new Uint8Array(0)
    void request({ type: 'observe', visible: uiVisible, spectrum }).catch(reportError)
  }
  const applySnapshot = (snapshot: PlaybackSnapshot) => {
    if (stopped || failed) return
    if (!snapshot.full && (snapshot.session !== session || snapshot.revision !== revision + 1)) {
      if (snapshot.session === session && snapshot.revision <= revision) return
      void reconnect().catch(reportError)
      return
    }
    if (snapshot.session === session && snapshot.revision <= revision) return
    // 账号 epoch 先于 Provider 通知，页面请求及缓存会看到同一会话。
    const changed = PROVIDER_IDS.filter(id => providerAccountSession(id) !== snapshot.accountSessions[id])
    hydrateProviderAccountSessions(snapshot.accountSessions)
    changed.forEach(clearProviderRequestCache)
    const sessionChanged = session !== snapshot.session
    session = snapshot.session
    revision = snapshot.revision
    for (const [key, data] of Object.entries(snapshot.stores)) {
      const store = stores[key]
      if (!store || !data || typeof data !== 'object') continue
      const current = store.getState()
      const patch = Object.fromEntries(Object.entries(data).filter(([name]) => name in current && typeof current[name] !== 'function'))
      if (key === 'player') {
        if ('position' in patch || 'status' in patch) positionReceivedAt = performance.now()
        const next = { ...current, ...patch }
        if (next.playbackTransport === 'musickit') {
          const previousTrack = current.currentTrack as { source: string; id: unknown } | null
          const nextTrack = next.currentTrack as typeof previousTrack
          const reset = sessionChanged || current.playbackTransport !== next.playbackTransport
            || current.seekRevision !== next.seekRevision
            || previousTrack?.source !== nextTrack?.source || String(previousTrack?.id) !== String(nextTrack?.id)
          if (reset) appleLyricClock.reset(Number(next.position) || 0, next.status === 'playing', Number(next.duration) || 0)
          else appleLyricClock.update(Number(next.position) || 0, next.status === 'playing', Number(next.duration) || 0)
        }
      }
      store.setState(patch)
    }
  }
  const reconnect = (): Promise<void> => {
    if (reconnecting) return reconnecting
    reconnecting = request({ type: 'connect', storage: collectPlaybackStorage(localStorage) }).then(value => {
      if (!isSnapshot(value) || !value.full) throw new Error('独立播放器返回了无效状态，请重试')
      applySnapshot(value)
      connected = true
      observedVisible = undefined
      observe()
    }).finally(() => { reconnecting = undefined })
    return reconnecting
  }
  const offSnapshot = desktop.onPlaybackSnapshot(value => {
    if (stopped) return
    if (isSnapshot(value)) { applySnapshot(value); return }
    if (!value || typeof value !== 'object') return
    const event = value as { type?: string; data?: Uint8Array; error?: string }
    if (event.type === 'spectrum' && observedSpectrum && event.data instanceof Uint8Array) frequency = event.data
    else if (event.type === 'host-error') {
      failed = true
      frequency = new Uint8Array(0)
      appleLyricClock.reset(appleLyricClock.read(), false)
      stores.player.setState({ status: 'paused' })
      showError(event.error && event.error !== 'PLAYBACK_HOST_GONE' ? event.error : '独立播放器已停止，请重启应用恢复播放')
    }
  })
  // 恢复窗口时原生菜单可能先于 React 挂载到达，提前接收设置命令。
  const offSettings = desktop.onHotkey?.(({ action }) => {
    if (action !== 'settings' || stores.shortcuts?.getState().recording || document.querySelector?.('dialog[open]')) return
    void Promise.resolve(reconnecting).then(() => request({ type: 'action', store: 'controls', action: 'shortcut', args: ['settings'] })).catch(reportError)
  })
  for (const [key, actions] of Object.entries(remoteActions)) {
    const store = stores[key]
    if (!store) continue
    const patch: Record<string, unknown> = {}
    originalActions[key] = {}
    for (const action of actions) {
      originalActions[key][action] = store.getState()[action]
      patch[action] = (...input: unknown[]) => {
        if (failed || stopped) {
          const result = Promise.reject(new Error('独立播放器已停止，请重启应用恢复播放'))
          void result.catch(reportError)
          return result
        }
        const args = [...input]
        const cancellable = (key === 'downloads' && action === 'saveMany') || (key === 'apple' && action === 'refresh')
        const signal = cancellable ? args[key === 'downloads' ? 1 : 0] as AbortSignal | undefined : undefined
        if (cancellable) args.splice(key === 'downloads' ? 1 : 0, 1)
        const requestId = signal ? crypto.randomUUID() : undefined
        const cancel = () => { if (requestId) void request({ type: 'cancel', requestId }).catch(() => {}) }
        if (signal?.aborted) {
          const result = Promise.reject(new DOMException('操作已取消', 'AbortError'))
          void result.catch(() => {})
          return result
        }
        signal?.addEventListener('abort', cancel, { once: true })
        const result = request({ type: 'action', store: key, action, args, ...(requestId ? { requestId } : {}) })
          .finally(() => signal?.removeEventListener('abort', cancel))
        // void 动作也有拒绝处理；需要返回值的调用者仍得到真实结果/异常。
        void result.catch(error => { if (!signal?.aborted) reportError(error) })
        return result
      }
    }
    store.setState(patch)
  }
  const stopAuthFailureSync = initProviderAuthFailureSync()
  const player = stores.player
  const originalPlayerHelpers = Object.fromEntries(['_engine', '_lyricPosition', '_frequencyData'].map(key => [key, player.getState()[key]]))
  const lyricPosition = () => {
    const state = player.getState()
    // MusicKit 可能只发送整秒进度，不能用普通音频的半秒插值上限反复停住或回退。
    if (state.playbackTransport === 'musickit') return appleLyricClock.read()
    const position = typeof state.position === 'number' ? state.position : 0
    const elapsed = state.status === 'playing' ? Math.min(0.5, Math.max(0, performance.now() - positionReceivedAt) / 1000) : 0
    return Math.min(Number(state.duration) || Infinity, position + elapsed * (Number(state.rate) || 1))
  }
  player.setState({
    _engine: () => ({ get position() { return lyricPosition() } }),
    _lyricPosition: lyricPosition,
    _frequencyData: () => {
      if (visible()) { spectrumUntil = performance.now() + 1000; observe() }
      return frequency
    }
  })
  const offWindow = useWindowStore.subscribe(observe)
  document.addEventListener('visibilitychange', observe)
  document.addEventListener('focusin', syncShortcutBlock)
  document.addEventListener('focusout', syncShortcutBlock)
  window.addEventListener?.('focus', syncShortcutBlock)
  window.addEventListener?.('blur', syncShortcutBlock)
  const modalObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(syncShortcutBlock)
  if (document.body) modalObserver?.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
  const timer = setInterval(observe, 250)
  const stop = () => {
    if (stopped) return
    stopped = true
    offSnapshot()
    offSettings?.()
    stopAuthFailureSync()
    offWindow()
    clearInterval(timer)
    document.removeEventListener('visibilitychange', observe)
    document.removeEventListener('focusin', syncShortcutBlock)
    document.removeEventListener('focusout', syncShortcutBlock)
    window.removeEventListener?.('focus', syncShortcutBlock)
    window.removeEventListener?.('blur', syncShortcutBlock)
    modalObserver?.disconnect()
    void request({ type: 'observe', visible: false, spectrum: false }).catch(() => {})
    for (const [key, patch] of Object.entries(originalActions)) stores[key].setState(patch)
    player.setState(originalPlayerHelpers)
  }
  try { await reconnect(); return stop }
  catch (error) { stop(); throw new Error(connectionError(error)) }
}
