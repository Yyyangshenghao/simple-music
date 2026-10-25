import { create } from 'zustand'
import { useVisualStore } from './visual'
import { defaultShortcuts, normalizeAccelerator, normalizeBindings, type ShortcutScope } from '../lib/shortcuts'
import { ACCENT_MODES, isHexColor, type AccentMode } from '../lib/theme-tone'
import {
  DEFAULT_MINI_PLAYER_APPEARANCE,
  MINI_PLAYER_DEFAULT_WIDTH,
  MINI_PLAYER_MAX_WIDTH,
  MINI_PLAYER_MIN_WIDTH
} from '../lib/mini-player-config'
import type { HotkeyBinding, MiniPlayerAppearance } from '../types/ipc'
import type { AudioQuality, FxArchive, Lyrics3dEffect, Lyrics3dParams, Lyrics3dStyle, LyricsLayoutParams, LyricsPanelMode, PerformanceFlags, PlayMode } from '../types/domain'

export const SETTINGS_STORAGE_KEY = 'simplemusic-settings'
export const CONTENT_GUTTER_MIN = 16
export const CONTENT_GUTTER_MAX = 64
export const CONTENT_GUTTER_DEFAULT = 24

function normalizeContentGutter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(CONTENT_GUTTER_MAX, Math.max(CONTENT_GUTTER_MIN, Math.round(value)))
    : CONTENT_GUTTER_DEFAULT
}

// 仅升级完整的旧默认配置；任何自定义或主动清除的绑定都保留。
function migrateShortcutDefaults(value: unknown, scope: ShortcutScope, platform: string): unknown {
  if (!Array.isArray(value)) return value
  const defaults = defaultShortcuts(scope).filter((binding) => binding.action !== 'settings' && binding.action !== 'game-mode')
  const isOldDefault = value.length === defaults.length && defaults.every((binding) => {
    const old = binding.action === 'mini-player'
      ? scope === 'local' ? 'CommandOrControl+Shift+M' : 'CommandOrControl+Alt+M'
      : scope === 'global' ? binding.accelerator.replace('+Shift', '') : binding.accelerator
    return value.some((item) => item?.action === binding.action && typeof item.accelerator === 'string'
      && normalizeAccelerator(item.accelerator, platform) === normalizeAccelerator(old, platform))
  })
  const bindings = isOldDefault ? defaultShortcuts(scope) : value
  // 后加的动作（设置入口、游戏模式）：旧存档补上默认键，已自定义或主动清除此项时保留。
  const added = defaultShortcuts(scope).filter((binding) => binding.accelerator
    && (binding.action === 'settings' || binding.action === 'game-mode')
    && !bindings.some((item) => item?.action === binding.action))
  return added.length ? [...bindings, ...added] : bindings
}

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
  rippleAmplitude: 0.5,
  rippleSensitivity: 0.5,
  rippleDuration: 0.55,
  fpsCap: 120,
  renderScale: 1.25
}

export const DEFAULT_PERFORMANCE: PerformanceFlags = {
  reduceMotion: false,
  textRevealMotion: true,
  lyricsWordMotion: true,
  bgFluidMotion: true,
  bgPointerMotion: true,
  cardTiltEffect: true,
  cardSpotlightEffect: true,
  gradientTextMotion: true,
  audioGlowEffect: true,
  reduceTransparency: false,
}

function normalizeLyrics3dFpsCap(fps: number): number {
  if (fps === 0) return 0
  return Number.isFinite(fps) ? Math.max(30, Math.round(fps)) : 120
}

export type PerformancePreset = 'standard' | 'simple' | 'minimal'

/** 动效预设控制界面与装饰效果；透明度与 3D 歌词保持独立。 */
export const PERFORMANCE_PRESETS: Record<PerformancePreset, Omit<PerformanceFlags, 'reduceTransparency'>> = {
  standard: { reduceMotion: false, textRevealMotion: true, lyricsWordMotion: true, bgFluidMotion: true, bgPointerMotion: true, cardTiltEffect: true, cardSpotlightEffect: true, gradientTextMotion: true, audioGlowEffect: true },
  simple: { reduceMotion: false, textRevealMotion: false, lyricsWordMotion: true, bgFluidMotion: false, bgPointerMotion: false, cardTiltEffect: true, cardSpotlightEffect: true, gradientTextMotion: true, audioGlowEffect: true },
  minimal: { reduceMotion: true, textRevealMotion: false, lyricsWordMotion: false, bgFluidMotion: false, bgPointerMotion: false, cardTiltEffect: false, cardSpotlightEffect: false, gradientTextMotion: false, audioGlowEffect: false },
}

interface PersistedSettings {
  hotkeys: HotkeyBinding[]
  localHotkeys: HotkeyBinding[]
  globalHotkeysEnabled: boolean
  mediaKeysEnabled: boolean
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  /** 取消 QQ / 网易云红心前弹窗确认；确认框里勾选「不再提示」后关闭，可在设置里重新打开。 */
  unlikeConfirmation: boolean
  liveBackgroundKeep: boolean
  lyricsPanelMode: LyricsPanelMode
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
  /** 平台没有逐字时序时，按歌曲 ID 去 AMLL TTML DB（社区逐字歌词库）补全；会向 GitHub 或社区镜像发送歌曲 ID。 */
  lyricsAmllFallback: boolean
  /** 以上来源都没有逐字时序时，按歌名、歌手与时长去酷狗歌词库补全；会向酷狗发送这三项。 */
  lyricsKugouFallback: boolean
  /** 普通歌词页的播放操作：stage=封面下方的舞台控件，dock=沿用底部悬浮播放栏。 */
  lyricsPlayerStyle: 'stage' | 'dock'
  themeMode: 'auto' | 'light' | 'dark'
  /** 主题色：mono=原黑白单色，cover=跟随封面主色，custom=accentCustom，其余为预设。 */
  accentMode: AccentMode
  accentCustom: string
  contentLayout: 'framed' | 'full'
  contentGutter: number
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
  setLocalHotkeys(hotkeys: HotkeyBinding[]): void
  setGlobalHotkeysEnabled(enabled: boolean): void
  setMediaKeysEnabled(enabled: boolean): void
  resetShortcuts(): void
  setNeteaseLoggedIn(v: boolean): void
  setQQLoggedIn(v: boolean): void
  setNeteaseProfile(avatar: string, nickname: string): void
  setQQProfile(avatar: string, nickname: string): void
  setShelfShowPodcasts(v: boolean): void
  setShelfMergeCollections(v: boolean): void
  setUnlikeConfirmation(v: boolean): void
  setLiveBackgroundKeep(v: boolean): void
  setLyricsPanelMode(mode: LyricsPanelMode): void
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
  setLyricsAmllFallback(v: boolean): void
  setLyricsKugouFallback(v: boolean): void
  setLyricsPlayerStyle(v: 'stage' | 'dock'): void
  setThemeMode(m: 'auto' | 'light' | 'dark'): void
  setAccent(mode: AccentMode, custom?: string): void
  setContentLayout(layout: 'framed' | 'full'): void
  setContentGutter(value: number): void
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
  hotkeys: defaultShortcuts('global'),
  localHotkeys: defaultShortcuts('local'),
  globalHotkeysEnabled: true,
  mediaKeysEnabled: true,
  neteaseLoggedIn: false,
  qqLoggedIn: false,
  neteaseAvatar: '',
  neteaseNickname: '',
  qqAvatar: '',
  qqNickname: '',
  shelfShowPodcasts: true,
  shelfMergeCollections: false,
  unlikeConfirmation: true,
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
  lyricsAmllFallback: true,
  lyricsKugouFallback: true,
  lyricsPlayerStyle: 'stage',
  themeMode: 'auto',
  accentMode: 'mono',
  accentCustom: '#6366f1',
  contentLayout: 'framed',
  contentGutter: CONTENT_GUTTER_DEFAULT,
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
  setLocalHotkeys(localHotkeys) {
    set({ localHotkeys })
    get().saveToLocal()
  },
  setGlobalHotkeysEnabled(globalHotkeysEnabled) {
    set({ globalHotkeysEnabled })
    get().saveToLocal()
  },
  setMediaKeysEnabled(mediaKeysEnabled) {
    set({ mediaKeysEnabled })
    get().saveToLocal()
  },
  resetShortcuts() {
    set({ hotkeys: defaultShortcuts('global'), localHotkeys: defaultShortcuts('local'), globalHotkeysEnabled: true, mediaKeysEnabled: true })
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
  setUnlikeConfirmation(v) {
    set({ unlikeConfirmation: v })
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
    set({ lyrics3dStyle: (style as string) === 'focus' ? 'smooth' : style, lyricsStage3d: true })
    get().saveToLocal()
  },
  setLyricsOverlayBlur(v) {
    set({ lyricsOverlayBlur: Math.max(0, Math.min(1, v)) })
    get().saveToLocal()
  },
  setLyricsStage3d(v) {
    set({ lyricsStage3d: true, lyrics3dStyle: v ? 'float' : 'smooth' })
    get().saveToLocal()
  },
  setLyrics3dParams(patch) {
    set({ lyrics3d: {
      ...get().lyrics3d,
      ...patch,
      ...(patch.rippleAmplitude === undefined ? null : { rippleAmplitude: Math.max(0, Math.min(1, Number.isFinite(patch.rippleAmplitude) ? patch.rippleAmplitude : DEFAULT_LYRICS_3D.rippleAmplitude)) }),
      ...(patch.fpsCap === undefined ? null : { fpsCap: normalizeLyrics3dFpsCap(patch.fpsCap) })
    } })
    get().saveToLocal()
  },
  resetLyrics3dParams() {
    set({ lyrics3d: { ...DEFAULT_LYRICS_3D }, lyricsOverlayBlur: 0.4 })
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
  setLyricsAmllFallback(v) {
    set({ lyricsAmllFallback: v })
    get().saveToLocal()
  },
  setLyricsKugouFallback(v) {
    set({ lyricsKugouFallback: v })
    get().saveToLocal()
  },
  setLyricsShowRoma(v) {
    set({ lyricsShowRoma: v })
    get().saveToLocal()
  },
  setLyricsPlayerStyle(v) {
    set({ lyricsPlayerStyle: v })
    get().saveToLocal()
  },
  setThemeMode(m) {
    set({ themeMode: m })
    get().saveToLocal()
  },
  setAccent(mode, custom) {
    set({ accentMode: mode, ...(isHexColor(custom) ? { accentCustom: custom } : {}) })
    get().saveToLocal()
  },
  setContentGutter(value) {
    set({ contentGutter: normalizeContentGutter(value) })
    get().saveToLocal()
  },
  setContentLayout(contentLayout) {
    set({ contentLayout })
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
    const { hotkeys, localHotkeys, globalHotkeysEnabled, mediaKeysEnabled, shelfShowPodcasts, shelfMergeCollections, unlikeConfirmation, liveBackgroundKeep, lyricsPanelMode, lyrics3dEffect, lyrics3dStyle, lyricsOverlayBlur, lyricsStage3d, lyrics3d, lyricsFontScale, lyricsLayout, lyricsShowTranslation, lyricsShowRoma, lyricsAmllFallback, lyricsKugouFallback, lyricsPlayerStyle, themeMode, accentMode, accentCustom, contentLayout, contentGutter, audioQuality, playMode, fontFamily, fontFamilyCjk, lyricsFontFamily, lyricsFontFamilyCjk, lyrics3dFontFamily, lyrics3dFontFamilyCjk, performance, miniPlayerEnabled, miniPlayerWidth, miniPlayerAppearance } = get()
    const data: PersistedSettings = { hotkeys, localHotkeys, globalHotkeysEnabled, mediaKeysEnabled, shelfShowPodcasts, shelfMergeCollections, unlikeConfirmation, liveBackgroundKeep, lyricsPanelMode, lyrics3dEffect, lyrics3dStyle, lyricsOverlayBlur, lyricsStage3d, lyrics3d, lyricsFontScale, lyricsLayout, lyricsShowTranslation, lyricsShowRoma, lyricsAmllFallback, lyricsKugouFallback, lyricsPlayerStyle, themeMode, accentMode, accentCustom, contentLayout, contentGutter, audioQuality, playMode, fontFamily, fontFamilyCjk, lyricsFontFamily, lyricsFontFamilyCjk, lyrics3dFontFamily, lyrics3dFontFamilyCjk, performance, miniPlayerEnabled, miniPlayerWidth, miniPlayerAppearance }
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data))
  },

  loadFromLocal() {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return
    try {
      const data = JSON.parse(raw) as Partial<PersistedSettings>
      // 旧版把跃字 / 3D 存成歌词页模式；迁为「动态」前先把样式选择写进样式存档，
      // 否则下面改写并保存后，3D 用户再也读不回原来的选择。
      const legacyMode = data.lyricsPanelMode as string | undefined
      if ((legacyMode === '3d' || legacyMode === 'pop') && localStorage.getItem('simplemusic-lyric-styles') === null) {
        // 单独兜住：迁移写入失败不能让整份设置退回默认值。
        try {
          localStorage.setItem('simplemusic-lyric-styles', JSON.stringify({ style: legacyMode === '3d' ? 'stage3d' : 'pop', tunings: {} }))
        } catch { /* 存储不可用时样式 store 仍会按旧设置回读。 */ }
      }
      const platform = typeof window !== 'undefined' ? window.desktop?.platform ?? 'win32' : 'win32'
      const storedLyricsStyle: Lyrics3dStyle = (() => {
        const value = data.lyrics3dStyle as unknown
        if (value === 'stage') return 'float'
        if (value === 'cascade' || value === 'focus') return 'smooth'
        if (value === 'storyboard' || value === 'glass' || value === 'smooth' || value === 'float' || value === 'quick' || value === 'shine' || value === 'glitch') return value
        return data.lyricsStage3d === false ? 'smooth' : 'float'
      })()
      set({
        // 旧版默认写入空列表但没有配置入口；升级补上默认键。新版空列表表示主动清除。
        hotkeys: normalizeBindings(
          migrateShortcutDefaults(data.localHotkeys === undefined && Array.isArray(data.hotkeys) && data.hotkeys.length === 0 ? undefined : data.hotkeys, 'global', platform),
          defaultShortcuts('global'), platform
        ),
        localHotkeys: normalizeBindings(migrateShortcutDefaults(data.localHotkeys, 'local', platform), defaultShortcuts('local'), platform),
        globalHotkeysEnabled: data.globalHotkeysEnabled ?? true,
        mediaKeysEnabled: data.mediaKeysEnabled ?? true,
        shelfShowPodcasts: data.shelfShowPodcasts ?? true,
        shelfMergeCollections: data.shelfMergeCollections ?? false,
        unlikeConfirmation: data.unlikeConfirmation ?? true,
        liveBackgroundKeep: data.liveBackgroundKeep ?? false,
        // 旧版的跃字 / 3D 是独立模式，统一迁为「动态」，具体样式由 lyric-styles 读回。
        lyricsPanelMode: data.lyricsPanelMode === 'dynamic' || (data.lyricsPanelMode as string) === '3d' || (data.lyricsPanelMode as string) === 'pop' ? 'dynamic' : 'lyrics',
        // 频谱环、音箱沙粒已移除：旧存档里的任何场景值都迁回封面粒子云。
        lyrics3dEffect: 'cover-cloud',
        lyrics3dStyle: storedLyricsStyle,
        lyricsOverlayBlur: data.lyricsOverlayBlur ?? 0.4,
        lyricsStage3d: true,
        // 与默认值合并:旧存档缺少新增参数时取默认,保证升级后字段完整
        lyrics3d: (() => {
          const { rippleCount: legacyCount, ...stored } = (data.lyrics3d ?? {}) as Partial<Lyrics3dParams> & { rippleCount?: number }
          const amplitude = stored.rippleAmplitude ?? (legacyCount === 0 ? 0 : DEFAULT_LYRICS_3D.rippleAmplitude)
          return {
            ...DEFAULT_LYRICS_3D,
            ...stored,
            rippleAmplitude: Math.max(0, Math.min(1, Number.isFinite(amplitude) ? amplitude : DEFAULT_LYRICS_3D.rippleAmplitude)),
            fpsCap: normalizeLyrics3dFpsCap(stored.fpsCap ?? DEFAULT_LYRICS_3D.fpsCap)
          }
        })(),
        lyricsFontScale: data.lyricsFontScale ?? 1,
        lyricsLayout: { ...DEFAULT_LYRICS_LAYOUT, ...data.lyricsLayout },
        lyricsShowTranslation: data.lyricsShowTranslation ?? true,
        lyricsShowRoma: data.lyricsShowRoma ?? true,
        lyricsAmllFallback: data.lyricsAmllFallback ?? true,
        lyricsKugouFallback: data.lyricsKugouFallback ?? true,
        lyricsPlayerStyle: data.lyricsPlayerStyle === 'dock' ? 'dock' : 'stage',
        themeMode: data.themeMode ?? 'auto',
        accentMode: ACCENT_MODES.includes(data.accentMode as AccentMode) ? data.accentMode as AccentMode : 'mono',
        accentCustom: isHexColor(data.accentCustom) ? data.accentCustom : '#6366f1',
        contentLayout: data.contentLayout === 'full' ? 'full' : 'framed',
        contentGutter: normalizeContentGutter(data.contentGutter),
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
          // 移除旧全局火花和立体歌词总开关；跟随/光斑继承旧组合选择，已单独配置时原样保留。
          const { clickSparkEffect: _removed, lyrics3dEnabled: _removed3dGate, ...stored } = (data.performance ?? {}) as Partial<PerformanceFlags> & { clickSparkEffect?: boolean; lyrics3dEnabled?: boolean }
          return {
            ...DEFAULT_PERFORMANCE,
            ...stored,
            bgPointerMotion: stored.bgPointerMotion ?? stored.bgFluidMotion ?? DEFAULT_PERFORMANCE.bgPointerMotion,
            cardSpotlightEffect: stored.cardSpotlightEffect ?? stored.cardTiltEffect ?? DEFAULT_PERFORMANCE.cardSpotlightEffect,
            audioGlowEffect: stored.audioGlowEffect ?? stored.gradientTextMotion ?? DEFAULT_PERFORMANCE.audioGlowEffect,
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
