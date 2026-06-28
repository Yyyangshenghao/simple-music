import type { ShapeKind } from './shapes'

export interface PresetConfig {
  id: number
  name: string
  shape: ShapeKind
  /** 基础粒子色（HSL 色相 0..1，运行时按 fx.color 偏移）。 */
  hue: number
}

export const PRESETS: PresetConfig[] = [
  { id: 0, name: '星云', shape: 'sphere', hue: 0.58 },
  { id: 1, name: '银河', shape: 'galaxy', hue: 0.75 },
  { id: 2, name: '声波', shape: 'wave', hue: 0.45 },
  { id: 3, name: '迸发', shape: 'burst', hue: 0.05 },
  { id: 4, name: '头骨', shape: 'skull', hue: 0.0 },
  { id: 5, name: '深海', shape: 'sphere', hue: 0.52 },
  { id: 6, name: '极光', shape: 'wave', hue: 0.38 },
  { id: 7, name: '烈焰', shape: 'burst', hue: 0.08 }
]

export function presetById(id: number): PresetConfig {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}
