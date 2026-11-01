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
  /** 登录页地区（两位小写地区码）；空字符串表示按出口 IP。登录后跟随账号地区。 */
  loginStorefront?(): string
  /** 未登录时指定登录页地区；已登录或地区码无效时返回 false。 */
  setLoginStorefront?(value: string): boolean
}
