// service 单例集中在此：所有调用方都按实体自身 source 显式取 service。

import { localMusicService } from './local-music-service'
import { providerFor } from '../providers/registry'
import type { NeteaseMusicService } from './netease-music-service'
import type { QQMusicService } from './qq-music-service'
import type { MusicService } from './music-service'
import type { MusicSource } from '../types/domain'

export const neteaseService = providerFor('netease').legacyService as NeteaseMusicService
export const qqService = providerFor('qq').legacyService as QQMusicService

export function serviceFor(source: MusicSource): MusicService {
  if (source === 'qq') return qqService
  if (source === 'local') return localMusicService
  return neteaseService
}
