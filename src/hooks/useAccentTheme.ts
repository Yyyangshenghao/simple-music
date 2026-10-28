import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settings'
import { useAmbientStore } from '../stores/ambient'
import { ACCENT_PRESETS, accentTokensFor } from '../lib/theme-tone'
import { useLightTheme } from './useLightTheme'

/** 主题色写进根节点的变量；mono 时全部移除，回到 tokens.css 的黑白单色。 */
const ACCENT_VARS = ['--sm-accent', '--sm-accent-hover', '--sm-accent-pressed', '--sm-accent-warm', '--sm-text-on-accent', '--sm-switch-track-on', '--sm-tint', '--sm-tint-strength'] as const
/** 玻璃面板、弹窗混入主题色的比例：浅色底更显色，比例更低。 */
const TINT_STRENGTH = { dark: '9%', light: '6%' }

/** 按设置与当前主题（以及跟随封面时的封面主色）同步主题色。 */
export function useAccentTheme(): void {
  const mode = useSettingsStore((s) => s.accentMode)
  const custom = useSettingsStore((s) => s.accentCustom)
  const coverColor = useAmbientStore((s) => (mode === 'cover' ? s.palette[0] : null))
  const light = useLightTheme()

  useEffect(() => {
    const root = document.documentElement
    const source = mode === 'cover' ? coverColor
      : mode === 'custom' ? custom
        : ACCENT_PRESETS.find(item => item.id === mode)?.color ?? null
    const tokens = mode === 'mono' || !source ? null : accentTokensFor(source, light)
    if (!tokens) {
      for (const name of ACCENT_VARS) root.style.removeProperty(name)
      root.removeAttribute('data-accent')
      return
    }
    root.style.setProperty('--sm-accent', tokens.accent)
    root.style.setProperty('--sm-accent-hover', tokens.hover)
    root.style.setProperty('--sm-accent-pressed', tokens.pressed)
    root.style.setProperty('--sm-accent-warm', `color-mix(in srgb, ${tokens.accent} 72%, transparent)`)
    root.style.setProperty('--sm-text-on-accent', tokens.onAccent)
    root.style.setProperty('--sm-switch-track-on', tokens.accent)
    root.style.setProperty('--sm-tint', tokens.accent)
    root.style.setProperty('--sm-tint-strength', light ? TINT_STRENGTH.light : TINT_STRENGTH.dark)
    root.setAttribute('data-accent', mode)
  }, [mode, custom, coverColor, light])
}
