import { createHmac, randomBytes } from 'node:crypto'

const salt = randomBytes(32)

/** 仅用于本地上报的账号绑定，不暴露或持久化平台凭据。 */
export function playbackAccountToken(cookie: string): string | null {
  return cookie ? createHmac('sha256', salt).update(cookie).digest('hex') : null
}

export function validListeningSeconds(value: unknown): number | null {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 86400 ? Math.floor(seconds) : null
}
