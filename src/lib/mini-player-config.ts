import type { MiniPlayerAppearance } from '../types/ipc'

/**
 * 迷你播放条的共享常量。单独成文件是为了让 overlay 入口能引用默认外观，
 * 而不必把 zustand store 链（settings → visual）拖进 overlay 包。
 * 宽度区间需与主进程 overlay-manager 的 MIN/MAX 保持一致。
 */
export const MINI_PLAYER_MIN_WIDTH = 300
export const MINI_PLAYER_MAX_WIDTH = 760
export const MINI_PLAYER_DEFAULT_WIDTH = 360
/** 宽度达到该值后展开歌词行，与 MiniPlayerBar 内的断点一致。 */
export const MINI_PLAYER_LYRICS_WIDTH = 440

export const DEFAULT_MINI_PLAYER_APPEARANCE: MiniPlayerAppearance = {
  opacity: 0.72,
  blur: 20,
  tint: 'cover',
  showProgress: true,
  showLyrics: true
}
