import { MINI_PLAYER_MAX_WIDTH, MINI_PLAYER_MIN_WIDTH } from './mini-player-config'

export interface MiniPlayerResizeSession {
  startX: number
  startWidth: number
  requestedWidth: number
}

function clampWidth(width: number): number {
  return Math.min(MINI_PLAYER_MAX_WIDTH, Math.max(MINI_PLAYER_MIN_WIDTH, width))
}

export function beginMiniPlayerResize(screenX: number, width: number): MiniPlayerResizeSession {
  const startWidth = clampWidth(width)
  return { startX: screenX, startWidth, requestedWidth: startWidth }
}

export function updateMiniPlayerResize(
  session: MiniPlayerResizeSession,
  screenX: number
): { session: MiniPlayerResizeSession; delta: number } {
  const requestedWidth = clampWidth(session.startWidth + screenX - session.startX)
  return {
    session: { ...session, requestedWidth },
    delta: requestedWidth - session.requestedWidth
  }
}
