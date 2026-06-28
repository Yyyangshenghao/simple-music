// 领域类型。Track/Playlist 对齐 server 返回（netease-client.ts 的 mapSongRecord/mapDiscoverPlaylist），
// FxParams/FxSnapshot 对齐 public/default-user-fx-archive.json 以保证存档互通。

export type MusicSource = 'netease' | 'qq'
export type AudioQuality = 'standard' | 'higher' | 'exhigh' | 'lossless'

export interface Artist {
  id: unknown
  name: string
}

export interface Track {
  provider: MusicSource
  source: MusicSource
  type: string
  id: unknown
  name: string
  artist: string
  artists: Artist[]
  artistId?: unknown
  album?: string
  cover?: string
  duration?: number
  fee?: unknown
  /** 解析出的可播放 URL（懒加载）。 */
  url?: string
  quality?: AudioQuality
  /** 不同来源透传的额外字段（mid/songmid 等）。 */
  [key: string]: unknown
}

export interface Playlist {
  provider: MusicSource
  source: MusicSource
  type: string
  id: unknown
  name: string
  cover: string
  trackCount: number
  playCount: number
  creator: string
  tag?: string
  tracks?: Track[]
}

export interface LyricLine {
  time: number
  text: string
}

export interface LyricLayout {
  scale: number
  offsetX: number
  offsetY: number
  offsetZ: number
  tiltX: number
  tiltY: number
  cameraLock: boolean
}

export type PresetId = number

/** 视觉 FX 参数快照——字段与 default-user-fx-archive.json 的 snapshot 完全对应。 */
export interface FxSnapshot {
  visualPresetSchema: string
  preset: number
  intensity: number
  cinemaShake: number
  depth: number
  coverResolution: number
  point: number
  speed: number
  twist: number
  color: number
  scatter: number
  bgFade: number
  bloomStrength: number
  lyricGlowStrength: number
  lyricScale: number
  lyricOffsetX: number
  lyricOffsetY: number
  lyricOffsetZ: number
  lyricTiltX: number
  lyricTiltY: number
  lyricCameraLock: boolean
  lyricColorMode: string
  lyricColor: string
  lyricHighlightMode: string
  lyricHighlightColor: string
  lyricGlowLinked: boolean
  lyricGlowColor: string
  lyricFont: string
  lyricLetterSpacing: number
  lyricLineHeight: number
  lyricWeight: number
  visualTintMode: string
  visualTintColor: string
  uiAccentColor: string
  homeAccentColor: string
  homeIconColor: string
  visualIconColor: string
  backgroundColorMode: string
  backgroundColor: string
  backgroundOpacity: number
  controlGlassChromaticOffset: number
  backgroundColorCustom: boolean
  floatLayer: boolean
  cinema: boolean
  edge: boolean
  aiDepth: boolean
  bloom: boolean
  lyricGlow: boolean
  lyricGlowBeat: boolean
  lyricGlowParticles: boolean
  desktopLyrics: boolean
  desktopLyricsSize: number
  desktopLyricsOpacity: number
  desktopLyricsY: number
  desktopLyricsClickThrough: boolean
  desktopLyricsCinema: boolean
  desktopLyricsHighlight: boolean
  desktopLyricsFps: number
  performanceBackground: string
  performanceQuality: string
  liveBackgroundKeep: boolean
  particleLyrics: boolean
  backCover: boolean
  shelf: string
  shelfCameraMode: string
  shelfPresence: string
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  shelfSize: number
  shelfOffsetX: number
  shelfOffsetY: number
  shelfOffsetZ: number
  shelfAngleY: number
  shelfAngleYManual: boolean
  shelfOpacity: number
  shelfBgOpacity: number
  shelfAccentColor: string
  cam: string
}

/** 运行期可调的 FX 参数，等价于快照（store 内部以此为 state）。 */
export type FxParams = FxSnapshot

/** 导出存档信封——与原项目格式完全兼容。 */
export interface FxArchive {
  type: string
  schema: number
  exportedAt: number
  name: string
  savedAt: number
  snapshot: FxSnapshot
}

export type PerformanceMode = 'eco' | 'balanced' | 'high' | 'ultra'
export type BackgroundMode = 'auto' | 'keep' | 'release'
export type ShelfMode = 'dynamic' | 'static'
