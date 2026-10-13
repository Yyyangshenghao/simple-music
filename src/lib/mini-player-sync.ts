import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { useAmbientStore } from '../stores/ambient'
import { useSettingsStore } from '../stores/settings'
import { useShortcutStore } from '../stores/shortcuts'
import { useGameModeStore } from '../stores/game-mode'
import { normalizeAccelerator, isSystemReservedAccelerator } from './shortcuts'
import { sizedImage } from './image-size'
import { MINI_PLAYER_LYRICS_WIDTH } from './mini-player-config'
import { miniPlayerPatch } from './mini-player-state'
import type { MiniPlayerPayload } from '../types/ipc'

let stopMiniPlayerSync: (() => void) | undefined

/** 宿主持有迷你条数据同步；窗口开关仍由用户命令和主进程管理。 */
export function initMiniPlayerSync(): () => void {
  if (stopMiniPlayerSync) return stopMiniPlayerSync
  const desktop = window.desktop
  if (!desktop?.updateMiniPlayer) return () => {}
  let stopped = false
  let previousPayload: MiniPlayerPayload = {}
  let previousPlayer: ReturnType<typeof usePlayerStore.getState> | undefined
  let progressEnabled = false
  let timer: ReturnType<typeof setInterval> | undefined
  const clearTimer = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }
  const pushPosition = () => {
    if (!stopped) void desktop.updateMiniPlayer({ position: usePlayerStore.getState().position }).catch(() => {})
  }
  const sync = () => {
    if (stopped) return
    const settings = useSettingsStore.getState()
    const gameMode = useGameModeStore.getState()
    if (!gameMode.initialized || !settings.miniPlayerEnabled || gameMode.enabled) {
      clearTimer()
      progressEnabled = false
      previousPlayer = undefined
      previousPayload = {}
      return
    }
    const player = usePlayerStore.getState()
    const shortcuts = useShortcutStore.getState()
    const platform = desktop.platform ?? 'win32'
    const localReturn = normalizeAccelerator(settings.localHotkeys.find(item => item.action === 'mini-player')?.accelerator ?? '', platform)
    // 同键且正在注册/注册成功时，全局入口负责分发，避免一次按键切换两次。
    const registered = settings.globalHotkeysEnabled && !!localReturn && (shortcuts.pending
      ? settings.hotkeys.some(item => normalizeAccelerator(item.accelerator, platform) === localReturn)
      : shortcuts.results.some(item => item.ok && normalizeAccelerator(item.accelerator, platform) === localReturn))
    const returnShortcut = localReturn && !shortcuts.recording && !registered && !isSystemReservedAccelerator(localReturn, platform) ? localReturn : ''
    const lyrics = useLyricsStore.getState()
    const trackKey = player.currentTrack ? `${player.currentTrack.source}:${String(player.currentTrack.id)}` : null
    const showLyrics = settings.miniPlayerAppearance.showLyrics && settings.miniPlayerWidth >= MINI_PLAYER_LYRICS_WIDTH
    const payload: MiniPlayerPayload = {
      trackTitle: player.currentTrack?.name ?? '',
      artistName: player.currentTrack?.artist ?? '',
      coverUrl: player.currentTrack?.cover ? sizedImage(player.currentTrack.cover, 88) : '',
      playing: player.status === 'playing' || (player.currentTrack?.source === 'apple' && player.status === 'loading'),
      volume: player.volume,
      duration: player.duration,
      accent: useAmbientStore.getState().palette[0],
      appearance: settings.miniPlayerAppearance,
      returnShortcut,
      lyricLine: showLyrics && !!trackKey && lyrics.trackKey === trackKey && lyrics.currentIndex >= 0 ? lyrics.lines[lyrics.currentIndex]?.text ?? '' : ''
    }
    const patch = miniPlayerPatch(previousPayload, payload)
    previousPayload = payload
    if (Object.keys(patch).length) void desktop.updateMiniPlayer(patch).catch(() => {})

    // 可见进度播放中只按 1Hz 推送；暂停拖动、切曲及重新展示立即补推末态。
    const nextProgressEnabled = settings.miniPlayerAppearance.showProgress
    if (nextProgressEnabled !== progressEnabled || player.status !== previousPlayer?.status || player.currentTrack !== previousPlayer?.currentTrack) {
      clearTimer()
      if (nextProgressEnabled) {
        pushPosition()
        if (player.status === 'playing') timer = setInterval(pushPosition, 1000)
      }
    } else if (nextProgressEnabled && player.status !== 'playing' && player.position !== previousPlayer?.position) pushPosition()
    progressEnabled = nextProgressEnabled
    previousPlayer = player
  }
  const stopPlayer = usePlayerStore.subscribe((state, previous) => {
    if (state.currentTrack !== previous.currentTrack || state.status !== previous.status
      || state.volume !== previous.volume || state.duration !== previous.duration
      || (state.status !== 'playing' && state.position !== previous.position)) sync()
  })
  const stopSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.miniPlayerEnabled !== previous.miniPlayerEnabled || state.miniPlayerWidth !== previous.miniPlayerWidth
      || state.miniPlayerAppearance !== previous.miniPlayerAppearance || state.localHotkeys !== previous.localHotkeys
      || state.hotkeys !== previous.hotkeys || state.globalHotkeysEnabled !== previous.globalHotkeysEnabled) sync()
  })
  const stopShortcuts = useShortcutStore.subscribe((state, previous) => {
    if (state.recording !== previous.recording || state.pending !== previous.pending || state.results !== previous.results) sync()
  })
  const stopLyrics = useLyricsStore.subscribe((state, previous) => {
    const settings = useSettingsStore.getState()
    if (settings.miniPlayerEnabled && !useGameModeStore.getState().enabled
      && settings.miniPlayerAppearance.showLyrics && settings.miniPlayerWidth >= MINI_PLAYER_LYRICS_WIDTH
      && (state.trackKey !== previous.trackKey || state.currentIndex !== previous.currentIndex || state.lines !== previous.lines)) sync()
  })
  const stopAmbient = useAmbientStore.subscribe((state, previous) => {
    if (state.palette[0] !== previous.palette[0]) sync()
  })
  const stopGameMode = useGameModeStore.subscribe((state, previous) => {
    if (state.enabled !== previous.enabled || state.initialized !== previous.initialized) sync()
  })
  const stopWidth = desktop.onMiniPlayerWidthChanged(({ width }) => {
    if (!stopped) useSettingsStore.getState().setMiniPlayerWidth(width)
  })
  sync()
  stopMiniPlayerSync = () => {
    if (stopped) return
    stopped = true
    clearTimer()
    stopPlayer()
    stopSettings()
    stopShortcuts()
    stopLyrics()
    stopAmbient()
    stopGameMode()
    stopWidth()
    stopMiniPlayerSync = undefined
  }
  return stopMiniPlayerSync
}
