export const DESKTOP_LYRICS_MIN_SIZE = 12
export const DESKTOP_LYRICS_MAX_SIZE = 10000
export const DESKTOP_LYRICS_LINE_HEIGHT = 1.25
export const DESKTOP_LYRICS_TRANSLATION_SCALE = 0.6
export const DESKTOP_LYRICS_GAP = 4
// 顶部 32px 留给解锁图标，底部 6px；底框边框 2px、文字上下各 4px。
const WINDOW_INSET = 48

export function desktopLyricsHeight(size: number, translation: boolean, roma = false, nextLine = false): number {
  const secondaryLines = Number(translation) + Number(roma)
  return WINDOW_INSET + size * DESKTOP_LYRICS_LINE_HEIGHT * (1 + Number(nextLine) + secondaryLines * DESKTOP_LYRICS_TRANSLATION_SCALE)
    + (secondaryLines + Number(nextLine)) * DESKTOP_LYRICS_GAP
}

export function desktopLyricsSize(height: number, translation: boolean, roma = false, nextLine = false): number {
  const secondaryLines = Number(translation) + Number(roma)
  return Math.max(DESKTOP_LYRICS_MIN_SIZE, (height - WINDOW_INSET - (secondaryLines + Number(nextLine)) * DESKTOP_LYRICS_GAP)
    / (DESKTOP_LYRICS_LINE_HEIGHT * (1 + Number(nextLine) + secondaryLines * DESKTOP_LYRICS_TRANSLATION_SCALE)))
}
