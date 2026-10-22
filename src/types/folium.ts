/** 本应用实现的 Folium 歌词视觉子集；不表示完整 Folium 宿主。 */
export interface LyricMod {
  id: string
  name: string
  version: string
  author: string
  description: string
  preview: string
  channel: 'release' | 'beta'
  compatible: boolean
  reason: string
  digest: string
}

export interface InstalledLyricMod extends LyricMod {
  valid: boolean
}

export interface LyricModCatalog {
  mods: LyricMod[]
}

export interface ModSetting {
  key: string
  type: 'number' | 'boolean' | 'select'
  label: string
  min?: number
  max?: number
  step?: number
  defaultValue: number | boolean | string
  options?: { value: string; label: string }[]
}

export interface ModLine {
  fullText: string
  startTime: number
  endTime: number
  words: { text: string; startTime: number; endTime: number }[]
  translation?: string
  romanization?: string
}

export interface ModTheme {
  name: string
  backgroundColor: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  fontStyle: 'sans'
  fontFamily: string
  fontWeight: number
  animationIntensity: 'calm' | 'normal'
  isDaylight: boolean
}

export interface ModSnapshot {
  trackKey: string
  lines: ModLine[]
  song: { id: string; title: string; artist: string; album: string } | null
  theme: ModTheme
  duration: number
  fontScale: number
  subtitleMode: 'translation' | 'romanization' | 'none'
  settings: Record<string, unknown>
  motion: boolean
}

export interface ModTick {
  time: number
  index: number
  paused: boolean
  spectrum: Uint8Array
}
