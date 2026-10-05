import { useEffect } from 'react'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { useAmbientStore } from '../stores/ambient'
import { useSettingsStore } from '../stores/settings'
import { useShortcutStore } from '../stores/shortcuts'
import { normalizeAccelerator, isSystemReservedAccelerator } from '../lib/shortcuts'
import { sizedImage } from '../lib/image-size'
import { MINI_PLAYER_LYRICS_WIDTH } from '../lib/mini-player-config'

/**
 * 主窗口 → 迷你播放条 overlay 的状态推送（enable/disable 走独立通道）。
 * 拆成三条独立 effect：元数据按需推、可见进度只在播放中 1Hz 推、歌词只在展开态推，
 * 避免每秒发送整包 payload。overlay 未开启时一律不推。
 */
export function useMiniPlayerSync(suspended = false): void {
  const enabled = useSettingsStore((s) => !suspended && s.miniPlayerEnabled)
  const appearance = useSettingsStore((s) => s.miniPlayerAppearance)
  const width = useSettingsStore((s) => s.miniPlayerWidth)
  const localHotkeys = useSettingsStore((s) => s.localHotkeys)
  const hotkeys = useSettingsStore((s) => s.hotkeys)
  const globalEnabled = useSettingsStore((s) => s.globalHotkeysEnabled)
  const recording = useShortcutStore((s) => s.recording)
  const pending = useShortcutStore((s) => s.pending)
  const results = useShortcutStore((s) => s.results)
  const platform = window.desktop?.platform ?? 'win32'
  const localReturn = normalizeAccelerator(localHotkeys.find((item) => item.action === 'mini-player')?.accelerator ?? '', platform)
  // 与主窗口一样：已注册（或正在注册）的同键全局绑定负责分发，防止一次按键切换两次。
  const registered = globalEnabled && !!localReturn && (pending
    ? hotkeys.some((item) => normalizeAccelerator(item.accelerator, platform) === localReturn)
    : results.some((item) => item.ok && normalizeAccelerator(item.accelerator, platform) === localReturn))
  const returnShortcut = localReturn && !recording && !registered && !isSystemReservedAccelerator(localReturn, platform) ? localReturn : ''
  const showLyrics = appearance.showLyrics && width >= MINI_PLAYER_LYRICS_WIDTH
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const status = usePlayerStore((s) => s.status)
  const volume = usePlayerStore((s) => s.volume)
  const duration = usePlayerStore((s) => s.duration)
  const accent = useAmbientStore((s) => s.palette[0])
  // 未展示歌词时固定选中空串,避免每次歌词换行都唤醒主窗口组件并发送空 payload。
  const lyricLine = useLyricsStore((s) => {
    if (!enabled || !showLyrics || s.currentIndex < 0) return ''
    return s.lines[s.currentIndex]?.text ?? ''
  })

  // 曲目 / 播放态 / 音量 / 外观
  useEffect(() => {
    if (!enabled) return
    const d = window.desktop
    if (!d) return
    void d.updateMiniPlayer({
      trackTitle: currentTrack?.name ?? '',
      artistName: currentTrack?.artist ?? '',
      coverUrl: currentTrack?.cover ? sizedImage(currentTrack.cover, 88) : '',
      playing: status === 'playing' || (currentTrack?.source === 'apple' && status === 'loading'),
      volume,
      duration,
      accent,
      appearance
    })
  }, [enabled, currentTrack, status, volume, duration, accent, appearance])

  useEffect(() => {
    if (enabled) void window.desktop?.updateMiniPlayer({ returnShortcut })
  }, [enabled, returnShortcut])

  // 进度:展示时播放中每秒推一次;暂停/切曲/重新展示时补推一次末态
  useEffect(() => {
    if (!enabled || !appearance.showProgress) return
    const d = window.desktop
    if (!d) return
    const push = () => void d.updateMiniPlayer({ position: usePlayerStore.getState().position })
    push()
    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (state.status !== 'playing' && state.position !== previous.position) push()
    })
    const timer = status === 'playing' ? setInterval(push, 1000) : undefined
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [enabled, appearance.showProgress, status, currentTrack])

  // 歌词行:仅展开态需要
  useEffect(() => {
    if (!enabled) return
    const d = window.desktop
    if (!d) return
    void d.updateMiniPlayer({ lyricLine })
  }, [enabled, showLyrics, lyricLine])

  // overlay 拖拽改宽后回写设置
  useEffect(() => {
    const d = window.desktop
    if (!d?.onMiniPlayerWidthChanged) return
    return d.onMiniPlayerWidthChanged(({ width }) => useSettingsStore.getState().setMiniPlayerWidth(width))
  }, [])
}
