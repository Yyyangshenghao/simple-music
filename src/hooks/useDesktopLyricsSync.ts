import { useEffect, useRef } from 'react'
import { useLyricsStore } from '../stores/lyrics'
import { useVisualStore } from '../stores/visual'
import { useToastStore } from '../stores/toast'
import { usePlayerStore } from '../stores/player'

// 主窗口把当前歌词行推送给桌面歌词 overlay（窗口未开启时主进程仅缓存状态）。
export function useDesktopLyricsSync(): void {
  const sizeFromWindow = useRef<number | null>(null)
  const currentIndex = useLyricsStore((s) => s.currentIndex)
  const lines = useLyricsStore((s) => s.lines)
  const translation = useLyricsStore((s) => s.translation)
  const romaji = useLyricsStore((s) => s.romaji)
  const trackKey = useLyricsStore((s) => s.trackKey)
  const loading = useLyricsStore((s) => s.loading)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const enabled = useVisualStore((s) => s.fx.desktopLyrics)
  const size = useVisualStore((s) => s.fx.desktopLyricsSize)
  const fontFamily = useVisualStore((s) => s.fx.desktopLyricsFontFamily)
  const color = useVisualStore((s) => s.fx.desktopLyricsColor)
  const opacity = useVisualStore((s) => s.fx.desktopLyricsOpacity)
  const clickThrough = useVisualStore((s) => s.fx.desktopLyricsClickThrough)
  const highlight = useVisualStore((s) => s.fx.desktopLyricsHighlight)
  const showTranslation = useVisualStore((s) => s.fx.desktopLyricsShowTranslation)
  const showRoma = useVisualStore((s) => s.fx.desktopLyricsShowRoma)
  // 用户改字号后清除回传标记，之后调回旧值仍是新的窗口尺寸请求。
  if (sizeFromWindow.current !== null && size !== sizeFromWindow.current) sizeFromWindow.current = null
  const currentKey = currentTrack ? `${currentTrack.source}:${String(currentTrack.id)}` : null
  const matching = !!currentKey && currentKey === trackKey
  const fallback = currentTrack
    ? loading || !matching ? '正在获取歌词…' : lines.length ? currentTrack.name : '暂无歌词 · ' + currentTrack.name
    : '播放音乐后显示歌词'
  const payload = {
    line: matching && currentIndex >= 0 ? (lines[currentIndex]?.text || currentTrack?.name || fallback) : fallback,
    translation: matching && showTranslation && currentIndex >= 0 ? (translation[currentIndex]?.text ?? '') : '',
    roma: matching && showRoma && currentIndex >= 0 ? (romaji[currentIndex]?.text ?? '') : '',
    ...(size === sizeFromWindow.current ? {} : { size }), fontFamily, color, opacity, clickThrough, highlight
  }

  useEffect(() => {
    void window.desktop?.setDesktopLyricsEnabled(enabled, { ...payload, size }).catch(() => {
      useToastStore.getState().show('桌面歌词切换失败，请重试')
    })
    useLyricsStore.getState().setDesktopLyricsEnabled(enabled)
  }, [enabled])

  useEffect(() => {
    return window.desktop?.onDesktopLyricsEnabledState(({ enabled: next, requested }) => {
      // 自己的请求确认可能晚于下一次切换，不能覆盖用户最新意图。
      if (requested) return
      useVisualStore.getState().updateFx({ desktopLyrics: next })
      useLyricsStore.getState().setDesktopLyricsEnabled(next)
    })
  }, [])

  useEffect(() => {
    return window.desktop?.onDesktopLyricsLockState(({ locked }) => {
      useVisualStore.getState().updateFx({ desktopLyricsClickThrough: locked })
    })
  }, [])

  useEffect(() => {
    return window.desktop?.onDesktopLyricsSizeState(({ size: next }) => {
      // 原生拖拽回传只更新显示与存档，不能再把旧尺寸请求发回窗口。
      sizeFromWindow.current = next
      useVisualStore.getState().updateFx({ desktopLyricsSize: next })
    })
  }, [])

  useEffect(() => {
    const d = window.desktop
    if (!d) return
    void d.updateDesktopLyrics(payload).catch(() => {})
  }, [currentIndex, lines, translation, romaji, trackKey, loading, currentTrack, size, fontFamily, color, opacity, clickThrough, highlight, showTranslation, showRoma])
}
