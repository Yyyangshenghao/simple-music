import { useEffect } from 'react'
import { usePlayerStore } from '../stores/player'
import { useAmbientStore, type AmbientPalette } from '../stores/ambient'
import { api } from '../lib/api'
import { extractPalette, DEFAULT_PALETTE } from '../lib/extract-color'

/** 把调色板写入 store 与根节点 CSS 变量（tokens.css 的 @property + html transition 负责平滑过渡）。 */
function applyPalette(palette: AmbientPalette): void {
  useAmbientStore.getState().setPalette(palette)
  const root = document.documentElement
  root.style.setProperty('--ambient-1', palette[0])
  root.style.setProperty('--ambient-2', palette[1])
  root.style.setProperty('--ambient-3', palette[2])
}

/** 监听当前歌曲封面，提取霞光调色板并广播到全局（store + CSS 变量）。挂在 App 顶层。 */
export function useAmbientPalette(): void {
  const cover = usePlayerStore((s) => s.currentTrack?.cover)

  useEffect(() => {
    if (!cover) {
      applyPalette([...DEFAULT_PALETTE])
      return
    }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = api.url('/proxy/cover', { url: cover })
    img.onload = () => {
      if (!cancelled) applyPalette(extractPalette(img))
    }
    img.onerror = () => {
      if (!cancelled) applyPalette([...DEFAULT_PALETTE])
    }
    // 切歌竞态：只认最新封面的结果
    return () => {
      cancelled = true
    }
  }, [cover])
}
