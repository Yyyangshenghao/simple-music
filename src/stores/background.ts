import { create } from 'zustand'
import type { AppBackgroundKind, CustomBackgroundMedia, WallpaperSelection } from '../types/domain'

export const BACKGROUND_STORAGE_KEY = 'simplemusic-background'

export type FluidPaletteSource = 'cover' | 'custom'
export type FluidColors = [string, string, string]

/** 静态背景预设；theme 跟随主题底色，custom 使用 solidColor。tone 标明适配的主题，避免深色底配深色文字。 */
export const SOLID_BACKGROUNDS = [
  { id: 'theme', label: '跟随主题', tone: 'any', css: 'var(--sm-bg-base)' },
  { id: 'graphite', label: '石墨', tone: 'dark', css: '#17181c' },
  { id: 'midnight', label: '午夜蓝', tone: 'dark', css: 'linear-gradient(160deg, #13213a 0%, #070a12 70%)' },
  { id: 'dusk', label: '暮紫', tone: 'dark', css: 'linear-gradient(160deg, #2c1a3c 0%, #0d0a14 70%)' },
  { id: 'forest', label: '深林', tone: 'dark', css: 'linear-gradient(160deg, #11291f 0%, #060b09 70%)' },
  { id: 'ember', label: '余烬', tone: 'dark', css: 'linear-gradient(160deg, #3a1d14 0%, #0e0907 70%)' },
  { id: 'paper', label: '纸白', tone: 'light', css: '#f1eee8' },
  { id: 'mist', label: '雾蓝', tone: 'light', css: 'linear-gradient(160deg, #eef2f7 0%, #d5dce7 100%)' },
  { id: 'blush', label: '浅粉', tone: 'light', css: 'linear-gradient(160deg, #fbeef0 0%, #efdde3 100%)' },
  { id: 'sage', label: '浅绿', tone: 'light', css: 'linear-gradient(160deg, #eef4ee 0%, #dbe6dc 100%)' },
] as const

/** 当前主题可用的预设；与主题色调相反的预设不列出。 */
export function solidBackgroundsFor(light: boolean) {
  return SOLID_BACKGROUNDS.filter(item => item.tone === 'any' || item.tone === (light ? 'light' : 'dark'))
}

/** 预设与当前主题色调相反时（如切换了主题）回到主题底色；自定义颜色按用户选择原样使用。 */
export function solidBackgroundCss(settings: Pick<BackgroundSettings, 'solid' | 'solidColor'>, light: boolean): string {
  if (settings.solid === 'custom') return settings.solidColor
  return (solidBackgroundsFor(light).find(item => item.id === settings.solid) ?? SOLID_BACKGROUNDS[0]).css
}

export type SolidBackgroundId = (typeof SOLID_BACKGROUNDS)[number]['id'] | 'custom'

/** 场景壁纸的帧率上限；动态背景不必跟满刷新率，30 已足够顺滑。 */
export const WALLPAPER_SCENE_FPS = [24, 30, 60] as const
export type WallpaperSceneFps = (typeof WALLPAPER_SCENE_FPS)[number]
export const WALLPAPER_SCENE_QUALITIES = [
  { value: 'smooth', label: '流畅' },
  { value: 'balanced', label: '均衡' },
  { value: 'detailed', label: '精细' },
] as const
export type WallpaperSceneQuality = (typeof WALLPAPER_SCENE_QUALITIES)[number]['value']

/** 场景型壁纸的渲染选项；网页与视频型不受这些项控制。 */
export interface WallpaperSceneSettings {
  fps: WallpaperSceneFps
  quality: WallpaperSceneQuality
  /** 执行壁纸自带的 SceneScript（时钟、文字、音频与交互效果）；关闭后停在初始画面。 */
  scripts: boolean
  /** 把当前歌曲的频谱推给壁纸。 */
  audio: boolean
  /** 把鼠标位置推给壁纸，用于视差与点击。 */
  pointer: boolean
}

export const DEFAULT_WALLPAPER_SCENE: WallpaperSceneSettings = {
  fps: 30,
  quality: 'balanced',
  scripts: true,
  audio: true,
  pointer: true,
}

/**
 * 存档版本：2 起 mediaDim 表示自动遮罩之外的额外强度；旧存档里的是总遮罩，直接叠加会把画面盖没，读取时回到默认。
 * 3 起新增独立的 wallpaper 槽位（Wallpaper Engine 壁纸），不再与视频背景共用。
 * wallpaperScene 与 pauseOnBlur 是后续追加的增量字段，旧存档缺省时按默认值补齐，不影响已有语义。
 */
const BACKGROUND_VERSION = 3
/** mediaDim 语义改动的起始版本；之后的版本新增字段不影响它。 */
const MEDIA_DIM_VERSION = 2

export const MEDIA_BLUR_MAX = 40
export const MEDIA_DIM_MAX = 0.8

export interface BackgroundSettings {
  kind: AppBackgroundKind
  fluidPalette: FluidPaletteSource
  fluidColors: FluidColors
  /** 图片、视频各占一个槽位，切换类型时不丢另一种。 */
  image: CustomBackgroundMedia | null
  video: CustomBackgroundMedia | null
  /** Steam 订阅的 Wallpaper Engine 壁纸；只记录 id 与标题，文件留在原目录。 */
  wallpaper: WallpaperSelection | null
  /** 场景型壁纸的渲染与交互选项；对视频、网页型无效。 */
  wallpaperScene: WallpaperSceneSettings
  /** 媒体类背景（图片/视频/壁纸）的模糊半径(px)。 */
  mediaBlur: number
  /** 媒体类背景在自动可读遮罩之外再加的强度（0 = 只用自动值）；遮罩为主题底色，深色压暗、浅色提亮。 */
  mediaDim: number
  /** 窗口失焦时停帧；关闭后切到其他窗口仍继续播放，适合放在副屏。最小化/隐藏始终停。 */
  pauseOnBlur: boolean
  solid: SolidBackgroundId
  solidColor: string
}

interface BackgroundStore extends BackgroundSettings {
  update(patch: Partial<Omit<BackgroundSettings, 'image' | 'video' | 'wallpaper'>>): void
  /** 导入成功后放进对应槽位并切到该类型；替换掉的旧文件一并删除。 */
  setMedia(media: CustomBackgroundMedia): void
  clearMedia(kind: CustomBackgroundMedia['kind']): void
  /** 选中壁纸库里的条目并切到壁纸背景；传 null 清空（当前是壁纸时回落到流体）。 */
  setWallpaper(wallpaper: WallpaperSelection | null): void
}

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  kind: 'fluid',
  fluidPalette: 'cover',
  fluidColors: ['#5227ff', '#ff9ffc', '#b497cf'],
  image: null,
  video: null,
  wallpaper: null,
  wallpaperScene: DEFAULT_WALLPAPER_SCENE,
  mediaBlur: 0,
  mediaDim: 0.1,
  pauseOnBlur: true,
  solid: 'theme',
  solidColor: '#1b1d24',
}

const HEX = /^#[0-9a-f]{6}$/i
const KINDS: AppBackgroundKind[] = ['fluid', 'image', 'video', 'wallpaper', 'solid']
const SOLID_IDS: SolidBackgroundId[] = [...SOLID_BACKGROUNDS.map(item => item.id), 'custom']

function clamp(value: unknown, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback
}

function normalizeMedia(value: unknown, kind: CustomBackgroundMedia['kind']): CustomBackgroundMedia | null {
  const media = value as Partial<CustomBackgroundMedia> | null
  return media && typeof media.id === 'string' && media.kind === kind && typeof media.name === 'string'
    ? { id: media.id, kind, name: media.name } : null
}

function normalizeWallpaper(value: unknown): WallpaperSelection | null {
  const item = value as Partial<WallpaperSelection> | null
  if (!item || typeof item.id !== 'string' || !/^\d{1,20}$/.test(item.id) || typeof item.title !== 'string') return null
  const type = item.type
  return {
    id: item.id,
    title: item.title,
    type: type === 'video' || type === 'web' || type === 'scene' || type === 'application' ? type : 'unknown',
    hasPreview: item.hasPreview === true,
  }
}

function normalizeWallpaperScene(value: unknown): WallpaperSceneSettings {
  const saved = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof WallpaperSceneSettings, unknown>>
  const fps = WALLPAPER_SCENE_FPS.includes(saved.fps as WallpaperSceneFps) ? saved.fps as WallpaperSceneFps : DEFAULT_WALLPAPER_SCENE.fps
  const quality = WALLPAPER_SCENE_QUALITIES.some(item => item.value === saved.quality) ? saved.quality as WallpaperSceneQuality : DEFAULT_WALLPAPER_SCENE.quality
  return {
    fps,
    quality,
    scripts: typeof saved.scripts === 'boolean' ? saved.scripts : DEFAULT_WALLPAPER_SCENE.scripts,
    audio: typeof saved.audio === 'boolean' ? saved.audio : DEFAULT_WALLPAPER_SCENE.audio,
    pointer: typeof saved.pointer === 'boolean' ? saved.pointer : DEFAULT_WALLPAPER_SCENE.pointer,
  }
}

export function normalizeBackground(value: unknown): BackgroundSettings {
  const saved = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof BackgroundSettings | 'version', unknown>>
  const colors = Array.isArray(saved.fluidColors) && saved.fluidColors.length === 3 && saved.fluidColors.every(c => typeof c === 'string' && HEX.test(c))
    ? saved.fluidColors as FluidColors : DEFAULT_BACKGROUND.fluidColors
  const image = normalizeMedia(saved.image, 'image')
  const video = normalizeMedia(saved.video, 'video')
  const wallpaper = normalizeWallpaper(saved.wallpaper)
  let kind = KINDS.includes(saved.kind as AppBackgroundKind) ? saved.kind as AppBackgroundKind : DEFAULT_BACKGROUND.kind
  // 文件槽位为空时回到流体，避免显示一块空背景。
  if ((kind === 'image' && !image) || (kind === 'video' && !video) || (kind === 'wallpaper' && !wallpaper)) kind = 'fluid'
  return {
    kind,
    fluidPalette: saved.fluidPalette === 'custom' ? 'custom' : 'cover',
    fluidColors: [...colors],
    image,
    video,
    wallpaper,
    wallpaperScene: normalizeWallpaperScene(saved.wallpaperScene),
    mediaBlur: clamp(saved.mediaBlur, MEDIA_BLUR_MAX, DEFAULT_BACKGROUND.mediaBlur),
    mediaDim: typeof saved.version === 'number' && saved.version >= MEDIA_DIM_VERSION ? clamp(saved.mediaDim, MEDIA_DIM_MAX, DEFAULT_BACKGROUND.mediaDim) : DEFAULT_BACKGROUND.mediaDim,
    pauseOnBlur: typeof saved.pauseOnBlur === 'boolean' ? saved.pauseOnBlur : DEFAULT_BACKGROUND.pauseOnBlur,
    solid: SOLID_IDS.includes(saved.solid as SolidBackgroundId) ? saved.solid as SolidBackgroundId : DEFAULT_BACKGROUND.solid,
    solidColor: typeof saved.solidColor === 'string' && HEX.test(saved.solidColor) ? saved.solidColor : DEFAULT_BACKGROUND.solidColor,
  }
}

function load(): BackgroundSettings {
  try { return normalizeBackground(JSON.parse(localStorage.getItem(BACKGROUND_STORAGE_KEY) ?? 'null')) } catch { return normalizeBackground(null) }
}

function save(state: BackgroundSettings): void {
  const { kind, fluidPalette, fluidColors, image, video, wallpaper, wallpaperScene, mediaBlur, mediaDim, pauseOnBlur, solid, solidColor } = state
  const data: BackgroundSettings = { kind, fluidPalette, fluidColors, image, video, wallpaper, wallpaperScene: { ...wallpaperScene }, mediaBlur, mediaDim, pauseOnBlur, solid, solidColor }
  try { localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify({ ...data, version: BACKGROUND_VERSION })) } catch { /* 存储不可用时本次会话仍可切换。 */ }
}

function removeFile(media: CustomBackgroundMedia | null): void {
  if (media) void window.desktop?.removeBackground?.(media.id)
}

export const useBackgroundStore = create<BackgroundStore>((set, get) => ({
  ...load(),
  update(patch) {
    const current = get()
    // 内存状态已是新语义，带上版本号，避免被当成旧存档重置压暗强度。
    const next = normalizeBackground({
      ...current,
      ...patch,
      wallpaperScene: patch.wallpaperScene ? { ...current.wallpaperScene, ...patch.wallpaperScene } : current.wallpaperScene,
      version: BACKGROUND_VERSION,
    })
    set(next)
    save(next)
  },
  setMedia(media) {
    const previous = get()[media.kind]
    if (previous?.id !== media.id) removeFile(previous)
    set({ [media.kind]: media, kind: media.kind } as Partial<BackgroundSettings>)
    save(get())
  },
  clearMedia(kind) {
    removeFile(get()[kind])
    set(state => ({ [kind]: null, kind: state.kind === kind ? 'fluid' : state.kind } as Partial<BackgroundSettings>))
    save(get())
  },
  setWallpaper(wallpaper) {
    const current = get()
    const kind = wallpaper ? 'wallpaper' : current.kind === 'wallpaper' ? 'fluid' : current.kind
    const next = normalizeBackground({ ...current, wallpaper, kind, version: BACKGROUND_VERSION })
    set(next)
    save(next)
  },
}))
