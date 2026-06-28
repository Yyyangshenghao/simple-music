import { useEffect } from 'react'
import { useLyricsStore } from '../stores/lyrics'
import { useVisualStore } from '../stores/visual'

// 主窗口把当前歌词行推送给桌面歌词 overlay（窗口未开启时主进程仅缓存状态）。
export function useDesktopLyricsSync(): void {
  const currentIndex = useLyricsStore((s) => s.currentIndex)
  const lines = useLyricsStore((s) => s.lines)
  const translation = useLyricsStore((s) => s.translation)

  useEffect(() => {
    const d = window.desktop
    if (!d) return
    const line = currentIndex >= 0 ? (lines[currentIndex]?.text ?? '') : ''
    const tr = currentIndex >= 0 ? (translation[currentIndex]?.text ?? '') : ''
    const fx = useVisualStore.getState().fx
    void d.updateDesktopLyrics({
      line,
      translation: tr,
      size: fx.desktopLyricsSize,
      highlight: fx.desktopLyricsHighlight
    })
  }, [currentIndex, lines, translation])
}
