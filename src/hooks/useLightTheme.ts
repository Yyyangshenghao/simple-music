import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settings'

/** 让 Canvas 材质与 CSS 使用同一手动/系统主题，系统变化时只更新一次。 */
export function useLightTheme(): boolean {
  const mode = useSettingsStore((s) => s.themeMode)
  const [systemLight, setSystemLight] = useState(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches === true
  )

  useEffect(() => {
    if (mode !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const sync = () => setSystemLight(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [mode])

  return mode === 'light' || (mode === 'auto' && systemLight)
}
