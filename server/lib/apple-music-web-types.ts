import type { AppleMusicBridgeState, AppleMusicCommand } from './apple-music-bridge'

export interface AppleMusicWebSession {
  open(): Promise<void>
  close(): Promise<void>
  logout(): Promise<void>
  /** 平台关闭时销毁后台页面但保留登录；resume 静默重连。 */
  suspend(): Promise<void>
  resume(): Promise<void>
  state(): AppleMusicBridgeState & { storefront: string; restoring?: boolean; suspended?: boolean }
  catalog(path: string): Promise<unknown>
  command(command: AppleMusicCommand): void
}
