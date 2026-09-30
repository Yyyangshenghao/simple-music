import { create } from 'zustand'
import { useVisualStore } from './visual'
import {
  DEFAULT_MINI_PLAYER_APPEARANCE,
  MINI_PLAYER_DEFAULT_WIDTH,
  MINI_PLAYER_MAX_WIDTH,
  MINI_PLAYER_MIN_WIDTH
} from '../lib/mini-player-config'
import type { HotkeyBinding, MiniPlayerAppearance } from '../types/ipc'
import type { AudioQuality, FxArchive, Lyrics3dEffect, Lyrics3dParams, Lyrics3dStyle, LyricsLayoutParams, PerformanceFlags, PlayMode } from '../types/domain'

export const SETTINGS_STORAGE_KEY = 'simplemusic-settings'

export const DEFAULT_LYRICS_LAYOUT: LyricsLayoutParams = {
  coverScale: 1,
  coverX: 0,
  coverY: 0,
  lyricsWidth: 56,
  lyricsX: 0,
  lyricsY: 0
}

/** 3D 歌词参数默认值,倍率类均为 1 即历史硬编码行为。 */
export const DEFAULT_LYRICS_3D: Lyrics3dParams = {
  // 对齐 Mineradio 2.2 默认存档：电影五行 + 漂浮曲线。
  displayMode: 'cinema',
  contextOpacity: 0.54,
  contextSpread: 1.96,
  edgeFade: 0.32,
  motionSoftness: 0.72,
  particleCount: 1,
  particleSize: 1,
  particleBrightness: 1,
  glowStrength: 1,
  motionIntensity: 1,
  rippleCount: 6,
  rippleSensitivity: 0.5,
  rippleDuration: 0.55,
  fpsCap: 120,
  renderScale: 1.25
}

export const DEFAULT_PERFORMANCE: PerformanceFlags = {
  bgFluidMotion: true,
  lyrics3dEnabled: true,
  cardTiltEffect: true,
  clickSparkEffect: true,
  gradientTextMotion: true,
  audioGlowEffect: true,
  reduceTransparency: false,
}

function normalizeLyrics3dFpsCap(fps: number): number {
  if (fps === 0) return 0
  return Number.isFinite(fps) ? Math.max(120, Math.round(fps)) : 120
}

export type PerformancePreset = 'standard' | 'simple' | 'minimal'

/** 界面动效预设只控制外观；3D 歌词有独立总开关。 */
export const PERFORMANCE_PRESETS: Record<PerformancePreset, Omit<PerformanceFlags, 'lyrics3dEnabled'>> = {
  standard: { bgFluidMotion: true, cardTiltEffect: true, clickSparkEffect: true, gradientTextMotion: true, audioGlowEffect: true, reduceTransparency: false },
  simple: { bgFluidMotion: false, cardTiltEffect: true, clickSparkEffect: true, gradientTextMotion: true, audioGlowEffect: true, reduceTransparency: false },
  minimal: { bgFluidMotion: false, cardTiltEffect: false, clickSparkEffect: false, gradientTextMotion: false, audioGlowEffect: false, reduceTransparency: true },
}

interface PersistedSettings {
  hotkeys: HotkeyBinding[]
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  liveBackgroundKeep: boolean
  lyricsPanelMode: 'lyrics' | '3d'
  lyrics3dEffect: Lyrics3dEffect
  /** 3D 场景上方的歌词排版与转场风格。 */
  lyrics3dStyle: Lyrics3dStyle
  /** 3D 歌词底部叠加层的模糊/背景强度，0=完全透明（无背景），1=最强毛玻璃。 */
  lyricsOverlayBlur: number
  /** 3D 模式歌词形态:true=场景内舞台歌词(移植自原版 Mineradio),false=DOM 叠加层。 */
  lyricsStage3d: boolean
  /** 3D 歌词场景可调参数(粒子/波纹/帧率等)。 */
  lyrics3d: Lyrics3dParams
  /** 纯歌词模式字号缩放倍率,1 为默认,范围 0.7–1.5。 */
  lyricsFontScale: number
  /** 普通歌词舞台中封面与歌词列的尺寸、位置。 */
  lyricsLayout: LyricsLayoutParams
  /** 纯歌词模式是否显示翻译行(有翻译数据时)。 */
  lyricsShowTranslation: boolean
  /** 纯歌词模式是否显示罗马音行(日语等有 romalrc 数据时)。 */
  lyricsShowRoma: boolean
  themeMode: 'auto' | 'light' | 'dark'
  audioQuality: AudioQuality
  playMode: PlayMode
  /** 自定义字体名称,空字符串表示跟随默认系统字体栈。 */
  fontFamily: string
  /** 界面中文回退字体,空字符串表示跟随系统默认。 */
  fontFamilyCjk: string
  /** 普通歌词字体,空字符串表示跟随界面字体。 */
  lyricsFontFamily: string
  /** 普通歌词中文回退字体,空字符串表示跟随界面字体。 */
  lyricsFontFamilyCjk: string
  /** 3D 歌词字体,空字符串表示跟随界面字体。 */
  lyrics3dFontFamily: string
  /** 3D 歌词中文回退字体,空字符串表示跟随界面字体。 */
  lyrics3dFontFamilyCjk: string
  /** 各项性能开关,详见 PerformanceFlags。 */
  performance: PerformanceFlags
  /** 迷你悬浮播放条:独立开关,与主窗口显隐无关。 */
  miniPlayerEnabled: boolean
  /** 迷你播放条宽度(px),由 overlay 拖拽手柄回传。 */
  miniPlayerWidth: number
  /** 迷你播放条外观参数。 */
  miniPlayerAppearance: MiniPlayerAppearance
}

interface SettingsStore extends PersistedSettings {
  neteaseLoggedIn: boolean
  qqLoggedIn: boolean
  neteaseAvatar: string
  neteaseNickname: string
  qqAvatar: string
  qqNickname: string
  setHotkeys(hotkeys: HotkeyBinding[]): void
  setNeteaseLoggedIn(v: boolean): void
  setQQLoggedIn(v: boolean): void
  setNeteaseProfile(avatar: string, nickname: string): void
  setQQProfile(avatar: string, nickname: string): void
  setShelfShowPodcasts(v: boolean): void
  setShelfMergeCollections(v: boolean): void
  setLiveBackgroundKeep(v: boolean): void
  setLyricsPanelMode(mode: 'lyrics' | '3d'): void
  setLyrics3dEffect(effect: Lyrics3dEffect): void
  setLyrics3dStyle(style: Lyrics3dStyle): void
  setLyricsOverlayBlur(v: number): void
  setLyricsStage3d(v: boolean): void
  setLyrics3dParams(patch: Partial<Lyrics3dParams>): void
  resetLyrics3dParams(): void
  setLyricsFontScale(v: number): void
  setLyricsLayout(patch: Partial<LyricsLayoutParams>): void
  resetLyricsLayout(): void
  setLyricsShowTranslation(v: boolean): void
  setLyricsShowRoma(v: boolean): void
  setThemeMode(m: 'auto' | 'light' | 'dark'): void
  setAudioQuality(q: AudioQuality): void
  setPlayMode(m: PlayMode): void
  setFontFamily(f: string): void
  setFontFamilyCjk(f: string): void
  setLyricsFontFamily(f: string): void
  setLyricsFontFamilyCjk(f: string): void
  setLyrics3dFontFamily(f: string): void
  setLyrics3dFontFamilyCjk(f: string): void
  setPerformance(patch: Partial<PerformanceFlags>): void
  applyPerformancePreset(preset: PerformancePreset): void
  setMiniPlayerEnabled(v: boolean): void
  setMiniPlayerWidth(v: number): void
  setMiniPlayerAppearance(patch: Partial<MiniPlayerAppearance>): void
  saveToLocal(): void
  loadFromLocal(): void
  exportArchive(name?: string): string
  importArchive(json: string): boolean
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  hotkeys: [],
  neteaseLoggedIn: false,
  qqLoggedIn: false,
  neteaseAvatar: '',
  neteaseNickname: '',
  qqAvatar: '',
  qqNickname: '',
  shelfShowPodcasts: true,
  shelfMergeCollections: false,
  liveBackgroundKeep: false,
  lyricsPanelMode: 'lyrics',
  lyrics3dEffect: 'cover-cloud',
  lyrics3dStyle: 'float',
  lyricsOverlayBlur: 0.4,
  lyricsStage3d: true,
  lyrics3d: { ...DEFAULT_LYRICS_3D },
  lyricsFontScale: 1,
  lyricsLayout: { ...DEFAULT_LYRICS_LAYOUT },
  lyricsShowTranslation: true,
  lyricsShowRoma: true,
  themeMode: 'auto',
  audioQuality: 'max',
  playMode: 'order',
  fontFamily: '',
  fontFamilyCjk: '',
  lyricsFontFamily: '',
  lyricsFontFamilyCjk: '',
  lyrics3dFontFamily: '',
  lyrics3dFontFamilyCjk: '',
  performance: { ...DEFAULT_PERFORMANCE },
  miniPlayerEnabled: false,
  miniPlayerWidth: MINI_PLAYER_DEFAULT_WIDTH,
  miniPlayerAppearance: { ...DEFAULT_MINI_PLAYER_APPEARANCE },

  setHotkeys(hotkeys) {
    set({ hotkeys })
    get().saveToLocal()
  },
  setNeteaseLoggedIn(v) {
    set(v ? { neteaseLoggedIn: v } : { neteaseLoggedIn: v, neteaseAvatar: '', neteaseNickname: '' })
  },
  setQQLoggedIn(v) {
    set(v ? { qqLoggedIn: v } : { qqLoggedIn: v, qqAvatar: '', qqNickname: '' })
  },
  setNeteaseProfile(avatar, nickname) {
    set({ neteaseAvatar: avatar, neteaseNickname: nickname })
  },
  setQQProfile(avatar, nickname) {
    set({ qqAvatar: avatar, qqNickname: nickname })
  },
  setShelfShowPodcasts(v) {
    set({ shelfShowPodcasts: v })
    get().saveToLocal()
  },
  setShelfMergeCollections(v) {
    set({ shelfMergeCollections: v })
    get().saveToLocal()
  },
  setLiveBackgroundKeep(v) {
    set({ liveBackgroundKeep: v })
    get().saveToLocal()
  },
  setLyricsPanelMode(mode) {
    set({ lyricsPanelMode: mode })
    get().saveToLocal()
  },
  setLyrics3dEffect(effect) {
    set({ lyrics3dEffect: effect })
    get().saveToLocal()
  },
  setLyrics3dStyle(style) {
    // 同步旧字段，保持降级到旧版时仍能回到最接近的歌词形态。
    set({ lyrics3dStyle: style, lyricsStage3d: style !== 'focus' })
    get().saveToLocal()
  },
  setLyricsOverlayBlur(v) {
    set({ lyricsOverlayBlur: Math.max(0, Math.min(1, v)) })
    get().saveToLocal()
  },
  setLyricsStage3d(v) {
    set({ lyricsStage3d: v, lyrics3dStyle: v ? 'float' : 'focus' })
    get().saveToLocal()
  },
  setLyrics3dParams(patch) {
    set({ lyrics3d: {
      ...get().lyrics3d,
      ...patch,
      ...(patch.fpsCap === undefined ? null : { fpsCap: normalizeLyrics3dFpsCap(patch.fpsCap) })
    } })
    get().saveToLocal()
  },
  resetLyrics3dParams() {
    set({ lyrics3d: { ...DEFAULT_LYRICS_3D } })
    get().saveToLocal()
  },
  setLyricsFontScale(v) {
    set({ lyricsFontScale: Math.max(0.7, Math.min(1.5, v)) })
    get().saveToLocal()
  },
  setLyricsLayout(patch) {
    const current = get().lyricsLayout
    set({
      lyricsLayout: {
        coverScale: Math.max(0.6, Math.min(1.4, patch.coverScale ?? current.coverScale)),
        coverX: Math.max(-20, Math.min(20, patch.coverX ?? current.coverX)),
        coverY: Math.max(-20, Math.min(20, patch.coverY ?? current.coverY)),
        lyricsWidth: Math.max(36, Math.min(68, patch.lyricsWidth ?? current.lyricsWidth)),
        lyricsX: Math.max(-20, Math.min(20, patch.lyricsX ?? current.lyricsX)),
        lyricsY: Math.max(-20, Math.min(20, patch.lyricsY ?? current.lyricsY))
      }
    })
    get().saveToLocal()
  },
  resetLyricsLayout() {
    set({ lyricsLayout: { ...DEFAULT_LYRICS_LAYOUT }, lyricsFontScale: 1 })
    get().saveToLocal()
  },
  setLyricsShowTranslation(v) {
    set({ lyricsShowTranslation: v })
    get().saveToLocal()
  },
  setLyricsShowRoma(v) {
    set({ lyricsShowRoma: v })
    get().saveToLocal()
  },
  setThemeMode(m) {
    set({ themeMode: m })
    get().saveToLocal()
  },
  setAudioQuality(q) {
    set({ audioQuality: q })
    get().saveToLocal()
  },
  setPlayMode(m) {
    set({ playMode: m })
    get().saveToLocal()
  },
  setFontFamily(f) {
    set({ fontFamily: f })
    get().saveToLocal()
  },
  setFontFamilyCjk(f) {
    set({ fontFamilyCjk: f })
    get().saveToLocal()
  },
  setLyricsFontFamily(f) {
    set({ lyricsFontFamily: f })
    get().saveToLocal()
  },
  setLyricsFontFamilyCjk(f) {
    set({ lyricsFontFamilyCjk: f })
    get().saveToLocal()
  },
  setLyrics3dFontFamily(f) {
    set({ lyrics3dFontFamily: f })
    get().saveToLocal()
  },
  setLyrics3dFontFamilyCjk(f) {
    set({ lyrics3dFontFamilyCjk: f })
    get().saveToLocal()
  },
  setPerformance(patch) {
    set({ performance: { ...get().performance, ...patch } })
    get().saveToLocal()
  },
  applyPerformancePreset(preset) {
    set({ performance: { ...get().performance, ...PERFORMANCE_PRESETS[preset] } })
    get().saveToLocal()
  },
  setMiniPlayerEnabled(v) {
    set({ miniPlayerEnabled: v })
    get().saveToLocal()
  },
  setMiniPlayerWidth(v) {
    const width = Math.round(Math.min(MINI_PLAYER_MAX_WIDTH, Math.max(MINI_PLAYER_MIN_WIDTH, v)))
    if (width === get().miniPlayerWidth) return
    set({ miniPlayerWidth: width })
    get().saveToLocal()
  },
  setMiniPlayerAppearance(patch) {
    set({ miniPlayerAppearance: { ...get().miniPlayerAppearance, ...patch } })
    get().saveToLocal()
  },

  saveToLocal() {
    if (typeof localStorage === 'undefined') return
    const { hotkeys, shelfShowPodcasts, shelfMergeCollections, liveBackgroundKeep, lyricsPanelMode, lyrics3dEffect, lyrics3dStyle, lyricsOverlayBlur, lyricsStage3d, lyrics3d, lyricsFontScale, lyricsLayout, lyricsShowTranslation, lyricsShowRoma, themeMode, audioQuality, playMode, fontFamily, fontFamilyCjk, lyricsFontFamily, lyricsFontFamilyCjk, lyrics3dFontFamily, lyrics3dFontFamilyCjk, performance, miniPlayerEnabled, miniPlayerWidth, miniPlayerAppearance } = get()
    const data: PersistedSettings = { hotkeys, shelfShowPodcasts, shelfMergeCollections, liveBackgroundKeep, lyricsPanelMode, lyrics3dEffect, lyrics3dStyle, lyricsOverlayBlur, lyricsStage3d, lyrics3d, lyricsFontScale, lyricsLayout, lyricsShowTranslation, lyricsShowRoma, themeMode, audioQuality, playMode, fontFamily, fontFamilyCjk, lyricsFontFamily, lyricsFontFamilyCjk, lyrics3dFontFamily, lyrics3dFontFamilyCjk, performance, miniPlayerEnabled, miniPlayerWidth, miniPlayerAppearance }
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data))
  },

  loadFromLocal() {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return
    try {
      const data = JSON.parse(raw) as Partial<PersistedSettings>
      const storedLyricsStyle: Lyrics3dStyle = (() => {
        const value = data.lyrics3dStyle as unknown
        if (value === 'stage') return 'float'
        if (value === 'cascade') return 'smooth'
        if (value === 'glass' || value === 'smooth' || value === 'float' || value === 'quick' || value === 'shine' || value === 'glitch' || value === 'focus') return value
        return data.lyricsStage3d === false ? 'focus' : 'float'
      })()
      set({
        hotkeys: data.hotkeys ?? [],
        shelfShowPodcasts: data.shelfShowPodcasts ?? true,
        shelfMergeCollections: data.shelfMergeCollections ?? false,
        liveBackgroundKeep: data.liveBackgroundKeep ?? false,
        lyricsPanelMode: data.lyricsPanelMode ?? 'lyrics',
        lyrics3dEffect: data.lyrics3dEffect ?? 'cover-cloud',
        lyrics3dStyle: storedLyricsStyle,
        lyricsOverlayBlur: data.lyricsOverlayBlur ?? 0.4,
        lyricsStage3d: storedLyricsStyle !== 'focus',
        // 与默认值合并:旧存档缺少新增参数时取默认,保证升级后字段完整
        lyrics3d: {
          ...DEFAULT_LYRICS_3D,
          ...data.lyrics3d,
          fpsCap: normalizeLyrics3dFpsCap(data.lyrics3d?.fpsCap ?? DEFAULT_LYRICS_3D.fpsCap)
        },
        lyricsFontScale: data.lyricsFontScale ?? 1,
        lyricsLayout: { ...DEFAULT_LYRICS_LAYOUT, ...data.lyricsLayout },
        lyricsShowTranslation: data.lyricsShowTranslation ?? true,
        lyricsShowRoma: data.lyricsShowRoma ?? true,
        themeMode: data.themeMode ?? 'auto',
        audioQuality: data.audioQuality ?? 'max',
        playMode: data.playMode ?? 'order',
        fontFamily: data.fontFamily ?? '',
        fontFamilyCjk: data.fontFamilyCjk ?? '',
        lyricsFontFamily: data.lyricsFontFamily ?? '',
        lyricsFontFamilyCjk: data.lyricsFontFamilyCjk ?? '',
        lyrics3dFontFamily: data.lyrics3dFontFamily ?? '',
        lyrics3dFontFamilyCjk: data.lyrics3dFontFamilyCjk ?? '',
        // 与默认值合并:旧存档没有 performance 字段或新增了开关时取默认,保证升级后字段完整。
        // audioGlowEffect 是后加的开关:旧存档没有它时跟随 gradientTextMotion 推断——
        // 关掉了流光呼吸(极简/自定义省电组合)的用户,默认也不要音频辉光
        performance: (() => {
          // 旧存档字段可能不全,按 Partial 处理
          const stored = data.performance as Partial<PerformanceFlags> | undefined
          return {
            ...DEFAULT_PERFORMANCE,
            ...(stored && stored.audioGlowEffect === undefined
              ? { audioGlowEffect: stored.gradientTextMotion ?? true }
              : null),
            ...stored,
          }
        })(),
        miniPlayerEnabled: data.miniPlayerEnabled ?? false,
        miniPlayerWidth: Math.round(
          Math.min(
            MINI_PLAYER_MAX_WIDTH,
            Math.max(MINI_PLAYER_MIN_WIDTH, Number(data.miniPlayerWidth) || MINI_PLAYER_DEFAULT_WIDTH)
          )
        ),
        miniPlayerAppearance: { ...DEFAULT_MINI_PLAYER_APPEARANCE, ...(data.miniPlayerAppearance ?? {}) },
      })
    } catch {
      /* ignore malformed */
    }
  },

  exportArchive(name = 'Simple Music 存档') {
    return JSON.stringify(useVisualStore.getState().saveArchive(name), null, 2)
  },

  importArchive(json) {
    try {
      const archive = JSON.parse(json) as FxArchive
      if (!archive?.snapshot) return false
      useVisualStore.getState().loadArchive(archive.snapshot)
      return true
    } catch {
      return false
    }
  }
}))
