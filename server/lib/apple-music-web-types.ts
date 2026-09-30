import type { AppleMusicBridgeState, AppleMusicCommand } from './apple-music-bridge'

export interface AppleMusicWebSession {
  open(): Promise<void>
  close(): Promise<void>
  logout(): Promise<void>
  state(): AppleMusicBridgeState & { storefront: string; restoring?: boolean }
  catalog(path: string): Promise<unknown>
  command(command: AppleMusicCommand): void
}
