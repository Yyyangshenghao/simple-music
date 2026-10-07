import type { ProviderId } from '../providers/types'

// 账号会话与平台启停、播放能力、偏好水合分开，避免旧请求影响重新登录的账号。
const sessions: Record<ProviderId, number> = { netease: 0, qq: 0, apple: 0 }

export function providerAccountSession(source: ProviderId): number {
  return sessions[source]
}

export function advanceProviderAccountSession(source: ProviderId): void {
  sessions[source]++
}

export class ProviderAuthError extends Error {
  constructor(message: string, readonly source: ProviderId, readonly accountSession: number) {
    super(message)
  }

  get isCurrentAccount(): boolean {
    return this.accountSession === providerAccountSession(this.source)
  }
}
