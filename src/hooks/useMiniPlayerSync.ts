import { useEffect } from 'react'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { useAmbientStore } from '../stores/ambient'
import { useSettingsStore } from '../stores/settings'
import { sizedImage } from '../lib/image-size'

/**
 * 主窗口 → 迷你播放条 overlay 的状态推送（enable/disable 走独立通道）。
 * 拆成三条独立 effect：元数据按需推、进度只在播放中 1Hz 推、歌词只在展开态推，
 * 避免每秒发送整包 payload。overlay 未开启时一律不推。
 */
export function useMiniPlayerSync(): void {
  const enabled = useSettingsStore((s) => s.miniPlayerEnabled)
  const appearance = useSettingsStore((s) => s.miniPlayerAppearance)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const status = usePlayerStore((s) => s.status)
  const volume = usePlayerStore((s) => s.volume)
  const duration = usePlayerStore((s) => s.duration)
  const accent = useAmbientStore((s) => s.palette[0])
  const lyricIndex = useLyricsStore((s) => s.currentIndex)
  const lines = useLyricsStore((s) => s.lines)

  // 曲目 / 播放态 / 音量 / 外观
  useEffect(() => {
    if (!enabled) return
    const d = window.desktop
    if (!d) return
    void d.updateMiniPlayer({
      trackTitle: currentTrack?.name ?? '',
      artistName: currentTrack?.artist ?? '',
      coverUrl: currentTrack?.cover ? sizedImage(currentTrack.cover, 88) : '',
      playing: status === 'playing',
      volume,
      duration,
      accent,
      appearance
    })
  }, [enabled, currentTrack, status, volume, duration, accent, appearance])

  // 进度:播放中每秒推一次;暂停/切曲时补推一次末态
  useEffect(() => {
    if (!enabled) return
    const d = window.desktop
    if (!d) return
    const push = () => void d.updateMiniPlayer({ position: usePlayerStore.getState().position })
    push()
    if (status !== 'playing') return
    const timer = setInterval(push, 1000)
    return () => clearInterval(timer)
  }, [enabled, status, currentTrack])

  // 歌词行:仅展开态需要
  useEffect(() => {
    if (!enabled) return
    const d = window.desktop
    if (!d) return
    const line = appearance.showLyrics && lyricIndex >= 0 ? (lines[lyricIndex]?.text ?? '') : ''
    void d.updateMiniPlayer({ lyricLine: line })
  }, [enabled, appearance.showLyrics, lyricIndex, lines])

  // overlay 拖拽改宽后回写设置
  useEffect(() => {
    const d = window.desktop
    if (!d?.onMiniPlayerWidthChanged) return
    return d.onMiniPlayerWidthChanged(({ width }) => useSettingsStore.getState().setMiniPlayerWidth(width))
  }, [])
}
