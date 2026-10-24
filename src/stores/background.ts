import { create } from 'zustand'
import type { AppBackgroundKind, CustomBackgroundMedia } from '../types/domain'

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

export const MEDIA_BLUR_MAX = 40
export const MEDIA_DIM_MAX = 0.8

export interface BackgroundSettings {
  kind: AppBackgroundKind
  fluidPalette: FluidPaletteSource
  fluidColors: FluidColors
  /** 图片与视频各占一个槽位，切换类型时不丢另一种。 */
  image: CustomBackgroundMedia | null
  video: CustomBackgroundMedia | null
  /** 图片/视频背景的模糊半径(px)。 */
  mediaBlur: number
  /** 图片/视频背景上方的主题底色压暗比例，保证文字可读。 */
  mediaDim: number
  solid: SolidBackgroundId
  solidColor: string
}

interface BackgroundStore extends BackgroundSettings {
  update(patch: Partial<Omit<BackgroundSettings, 'image' | 'video'>>): void
  /** 导入成功后放进对应槽位并切到该类型；替换掉的旧文件一并删除。 */
  setMedia(media: CustomBackgroundMedia): void
  clearMedia(kind: CustomBackgroundMedia['kind']): void
}

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  kind: 'fluid',
  fluidPalette: 'cover',
  fluidColors: ['#5227ff', '#ff9ffc', '#b497cf'],
  image: null,
  video: null,
  mediaBlur: 0,
  mediaDim: 0.35,
  solid: 'theme',
  solidColor: '#1b1d24',
}

const HEX = /^#[0-9a-f]{6}$/i
const KINDS: AppBackgroundKind[] = ['fluid', 'image', 'video', 'solid']
const SOLID_IDS: SolidBackgroundId[] = [...SOLID_BACKGROUNDS.map(item => item.id), 'custom']

function clamp(value: unknown, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback
}

function normalizeMedia(value: unknown, kind: CustomBackgroundMedia['kind']): CustomBackgroundMedia | null {
  const media = value as Partial<CustomBackgroundMedia> | null
  return media && typeof media.id === 'string' && media.kind === kind && typeof media.name === 'string'
    ? { id: media.id, kind, name: media.name } : null
}

export function normalizeBackground(value: unknown): BackgroundSettings {
  const saved = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof BackgroundSettings, unknown>>
  const colors = Array.isArray(saved.fluidColors) && saved.fluidColors.length === 3 && saved.fluidColors.every(c => typeof c === 'string' && HEX.test(c))
    ? saved.fluidColors as FluidColors : DEFAULT_BACKGROUND.fluidColors
  const image = normalizeMedia(saved.image, 'image')
  const video = normalizeMedia(saved.video, 'video')
  let kind = KINDS.includes(saved.kind as AppBackgroundKind) ? saved.kind as AppBackgroundKind : DEFAULT_BACKGROUND.kind
  // 文件槽位为空时回到流体，避免显示一块空背景。
  if ((kind === 'image' && !image) || (kind === 'video' && !video)) kind = 'fluid'
  return {
    kind,
    fluidPalette: saved.fluidPalette === 'custom' ? 'custom' : 'cover',
    fluidColors: [...colors],
    image,
    video,
    mediaBlur: clamp(saved.mediaBlur, MEDIA_BLUR_MAX, DEFAULT_BACKGROUND.mediaBlur),
    mediaDim: clamp(saved.mediaDim, MEDIA_DIM_MAX, DEFAULT_BACKGROUND.mediaDim),
    solid: SOLID_IDS.includes(saved.solid as SolidBackgroundId) ? saved.solid as SolidBackgroundId : DEFAULT_BACKGROUND.solid,
    solidColor: typeof saved.solidColor === 'string' && HEX.test(saved.solidColor) ? saved.solidColor : DEFAULT_BACKGROUND.solidColor,
  }
}

function load(): BackgroundSettings {
  try { return normalizeBackground(JSON.parse(localStorage.getItem(BACKGROUND_STORAGE_KEY) ?? 'null')) } catch { return normalizeBackground(null) }
}

function save(state: BackgroundSettings): void {
  const { kind, fluidPalette, fluidColors, image, video, mediaBlur, mediaDim, solid, solidColor } = state
  const data: BackgroundSettings = { kind, fluidPalette, fluidColors, image, video, mediaBlur, mediaDim, solid, solidColor }
  try { localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(data)) } catch { /* 存储不可用时本次会话仍可切换。 */ }
}

function removeFile(media: CustomBackgroundMedia | null): void {
  if (media) void window.desktop?.removeBackground?.(media.id)
}

export const useBackgroundStore = create<BackgroundStore>((set, get) => ({
  ...load(),
  update(patch) {
    const next = normalizeBackground({ ...get(), ...patch })
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
}))
