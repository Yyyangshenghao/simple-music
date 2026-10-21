import { useSyncExternalStore } from 'react'
import { useSettingsStore } from '../stores/settings'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches === true
}

// 当前 Motion 版本只读取初始偏好；显式订阅保证运行中切换系统设置也会生效。
export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** 系统偏好优先；应用内总开关不覆盖各单项的已保存选择。 */
export function useReducedMotion(): boolean {
  const systemReduced = useSystemReducedMotion()
  const reduceMotion = useSettingsStore((s) => s.performance.reduceMotion)
  return systemReduced || reduceMotion
}
