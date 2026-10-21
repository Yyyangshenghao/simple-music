import { useEffect } from 'react'
import { useReducedMotion } from './useReducedMotion'
import { useAmbientStore, type AmbientPalette } from '../stores/ambient'
import { useNavigationStore } from '../stores/navigation'

function setAmbientVars(colors: string[]): void {
  const root = document.documentElement
  root.style.setProperty('--ambient-1', colors[0])
  root.style.setProperty('--ambient-2', colors[1])
  root.style.setProperty('--ambient-3', colors[2])
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerpHex(from: string, to: string, t: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  if (!a || !b) return to
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

let tweenTimer: ReturnType<typeof setInterval> | null = null

/**
 * 把运行时产出的调色板分步补间到根节点 CSS 变量(约 800ms/12 步)。
 * 不能用根元素 CSS transition 做这件事:--ambient-* 是全文档继承的注册属性,
 * 过渡的每一帧都会触发整文档样式重算,一次切歌就产生上百 MB Blink 堆垃圾。
 * JS 分步把重算次数从 ~48 帧降到 12 步,视觉上色彩渐变几乎无差别。
 */
function applyPalette(palette: AmbientPalette): void {
  if (tweenTimer) clearInterval(tweenTimer)
  const root = document.documentElement
  const from = [1, 2, 3].map((i) => root.style.getPropertyValue(`--ambient-${i}`).trim() || '#5227ff')
  const STEPS = 12
  const INTERVAL = 66
  let step = 0
  tweenTimer = setInterval(() => {
    step += 1
    const t = step / STEPS
    if (t >= 1) {
      clearInterval(tweenTimer!)
      tweenTimer = null
      setAmbientVars([...palette])
      return
    }
    // ease-in-out
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    setAmbientVars(from.map((c, i) => lerpHex(c, palette[i], e)))
  }, INTERVAL)
}

/** 只消费运行时调色板更新界面颜色；卸载不停止取色或重置全局颜色。 */
export function useAmbientPalette(enabled = true): void {
  const reducedMotion = useReducedMotion()
  const palette = useAmbientStore((s) => s.palette)
  const shuangeActive = useNavigationStore((s) => s.currentView === 'shuange')

  useEffect(() => {
    if (!enabled || shuangeActive) {
      if (tweenTimer) clearInterval(tweenTimer)
      tweenTimer = null
      return
    }
    if (reducedMotion) setAmbientVars([...palette])
    else applyPalette(palette)
    return () => {
      if (tweenTimer) clearInterval(tweenTimer)
      tweenTimer = null
    }
  }, [enabled, palette, shuangeActive, reducedMotion])
}
