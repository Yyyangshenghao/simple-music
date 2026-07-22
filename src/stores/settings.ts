import { create } from 'zustand'
import { useVisualStore } from './visual'
import {
  DEFAULT_MINI_PLAYER_APPEARANCE,
  MINI_PLAYER_DEFAULT_WIDTH,
  MINI_PLAYER_MAX_WIDTH,
  MINI_PLAYER_MIN_WIDTH
} from '../lib/mini-player-config'
import type { HotkeyBinding, MiniPlayerAppearance } from '../types/ipc'
import type { AudioQuality, FxArchive, Lyrics3dEffect, Lyrics3dParams, PerformanceFlags, PlayMode } from '../types/domain'

const STORAGE_KEY = 'simplemusic-settings'

/** 3D 歌词参数默认值,倍率类均为 1 即历史硬编码行为。 */
export const DEFAULT_LYRICS_3D: Lyrics3dParams = {
  particleCount: 1,
  particleSize: 1,
  particleBrightness: 1,
  glowStrength: 1,
  motionIntensity: 1,
  rippleCount: 6,
  rippleSensitivity: 0.5,
  rippleDuration: 0.55,
  // 默认钳 60:ProMotion 屏不限帧会跑 120fps,GPU 负载翻倍但视觉收益极小
  fpsCap: 60,
  renderScale: 1.25
}

export const DEFAULT_PERFORMANCE: PerformanceFlags = {
  bgFluidMotion: true,
  lyrics3dEnabled: true,
  cardTiltEffect: true,
  clickSparkEffect: true,
  gradientTextMotion: true,
  audioGlowEffect: true,
}

export type PerformancePreset = 'standard' | 'simple' | 'minimal'

/** 设置页「性能」预设:标准=不关任何效果;简单=关掉两项开销最大的(背景流体/3D歌词);
 *  极简=在简单基础上把其余装饰性交互(卡片跟光/点击火花/流光文字)一并关掉。 */
export const PERFORMANCE_PRESETS: Record<PerformancePreset, PerformanceFlags> = {
  standard: { bgFluidMotion: true, lyrics3dEnabled: true, cardTiltEffect: true, clickSparkEffect: true, gradientTextMotion: true, audioGlowEffect: true },
  simple: { bgFluidMotion: false, lyrics3dEnabled: false, cardTiltEffect: true, clickSparkEffect: true, gradientTextMotion: true, audioGlowEffect: true },
  minimal: { bgFluidMotion: false, lyrics3dEnabled: false, cardTiltEffect: false, clickSparkEffect: false, gradientTextMotion: false, audioGlowEffect: false },
}

interface PersistedSettings {
  hotkeys: HotkeyBinding[]
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  liveBackgroundKeep: boolean
  lyricsPanelMode: 'lyrics' | '3d'
  lyrics3dEffect: Lyrics3dEffect
  /** 3D 歌词底部叠加层的模糊/背景强度，0=完全透明（无背景），1=最强毛玻璃。 */
  lyricsOverlayBlur: number
  /** 3D 模式歌词形态:true=场景内舞台歌词(移植自原版 Mineradio),false=DOM 叠加层。 */
  lyricsStage3d: boolean
  /** 3D 歌词场景可调参数(粒子/波纹/帧率等)。 */
  lyrics3d: Lyrics3dParams
  /** 纯歌词模式字号缩放倍率,1 为默认,范围 0.7–1.5。 */
  lyricsFontScale: number
  /** 纯歌词模式是否显示翻译行(有翻译数据时)。 */
  lyricsShowTranslation: boolean
  /** 纯歌词模式是否显示罗马音行(日语等有 romalrc 数据时)。 */
  lyricsShowRoma: boolean
  activeSource: 'netease' | 'qq'
  themeMode: 'auto' | 'light' | 'dark'
  audioQuality: AudioQuality
  playMode: PlayMode
  /** 自定义字体名称,空字符串表示跟随默认系统字体栈。 */
  fontFamily: string
  /** 当前音源无法播放时,自动去对侧音源搜同曲兜底播放。 */
  crossSourceFallback: boolean
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
  setLyricsOverlayBlur(v: number): void
  setLyricsStage3d(v: boolean): void
  setLyrics3dParams(patch: Partial<Lyrics3dParams>): void
  resetLyrics3dParams(): void
  setLyricsFontScale(v: number): void
  setLyricsShowTranslation(v: boolean): void
  setLyricsShowRoma(v: boolean): void
  setActiveSource(s: 'netease' | 'qq'): void
  setThemeMode(m: 'auto' | 'light' | 'dark'): void
  setAudioQuality(q: AudioQuality): void
  setPlayMode(m: PlayMode): void
  setFontFamily(f: string): void
  setCrossSourceFallback(v: boolean): void
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
  lyricsOverlayBlur: 0.4,
  lyricsStage3d: true,
  lyrics3d: { ...DEFAULT_LYRICS_3D },
  lyricsFontScale: 1,
  lyricsShowTranslation: true,
  lyricsShowRoma: true,
  activeSource: 'netease',
  themeMode: 'auto',
  audioQuality: 'max',
  playMode: 'order',
  fontFamily: '',
  crossSourceFallback: true,
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
  setLyricsOverlayBlur(v) {
    set({ lyricsOverlayBlur: Math.max(0, Math.min(1, v)) })
    get().saveToLocal()
  },
  setLyricsStage3d(v) {
    set({ lyricsStage3d: v })
    get().saveToLocal()
  },
  setLyrics3dParams(patch) {
    set({ lyrics3d: { ...get().lyrics3d, ...patch } })
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
  setLyricsShowTranslation(v) {
    set({ lyricsShowTranslation: v })
    get().saveToLocal()
  },
  setLyricsShowRoma(v) {
    set({ lyricsShowRoma: v })
    get().saveToLocal()
  },
  setActiveSource(s) {
    set({ activeSource: s })
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
  setCrossSourceFallback(v) {
    set({ crossSourceFallback: v })
    get().saveToLocal()
  },
  setPerformance(patch) {
    set({ performance: { ...get().performance, ...patch } })
    get().saveToLocal()
  },
  applyPerformancePreset(preset) {
    set({ performance: { ...PERFORMANCE_PRESETS[preset] } })
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
    const { hotkeys, shelfShowPodcasts, shelfMergeCollections, liveBackgroundKeep, lyricsPanelMode, lyrics3dEffect, lyricsOverlayBlur, lyricsStage3d, lyrics3d, lyricsFontScale, lyricsShowTranslation, lyricsShowRoma, activeSource, themeMode, audioQuality, playMode, fontFamily, crossSourceFallback, performance, miniPlayerEnabled, miniPlayerWidth, miniPlayerAppearance } = get()
    const data: PersistedSettings = { hotkeys, shelfShowPodcasts, shelfMergeCollections, liveBackgroundKeep, lyricsPanelMode, lyrics3dEffect, lyricsOverlayBlur, lyricsStage3d, lyrics3d, lyricsFontScale, lyricsShowTranslation, lyricsShowRoma, activeSource, themeMode, audioQuality, playMode, fontFamily, crossSourceFallback, performance, miniPlayerEnabled, miniPlayerWidth, miniPlayerAppearance }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  },

  loadFromLocal() {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const data = JSON.parse(raw) as Partial<PersistedSettings>
      set({
        hotkeys: data.hotkeys ?? [],
        shelfShowPodcasts: data.shelfShowPodcasts ?? true,
        shelfMergeCollections: data.shelfMergeCollections ?? false,
        liveBackgroundKeep: data.liveBackgroundKeep ?? false,
        lyricsPanelMode: data.lyricsPanelMode ?? 'lyrics',
        lyrics3dEffect: data.lyrics3dEffect ?? 'cover-cloud',
        lyricsOverlayBlur: data.lyricsOverlayBlur ?? 0.4,
        lyricsStage3d: data.lyricsStage3d ?? true,
        // 与默认值合并:旧存档缺少新增参数时取默认,保证升级后字段完整
        lyrics3d: { ...DEFAULT_LYRICS_3D, ...data.lyrics3d },
        lyricsFontScale: data.lyricsFontScale ?? 1,
        lyricsShowTranslation: data.lyricsShowTranslation ?? true,
        lyricsShowRoma: data.lyricsShowRoma ?? true,
        activeSource: data.activeSource ?? 'netease',
        themeMode: data.themeMode ?? 'auto',
        audioQuality: data.audioQuality ?? 'max',
        playMode: data.playMode ?? 'order',
        fontFamily: data.fontFamily ?? '',
        crossSourceFallback: data.crossSourceFallback ?? true,
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

  exportArchive(name = 'SimpleMusic 存档') {
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
