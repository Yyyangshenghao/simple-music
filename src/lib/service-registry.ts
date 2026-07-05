// service 单例集中在此:hook(useMusicService)与非 hook 场景(zustand store 按 track.source 取)共用。

import { NeteaseMusicService } from './netease-music-service'
import { QQMusicService } from './qq-music-service'
import type { MusicService } from './music-service'
import type { MusicSource } from '../types/domain'

export const neteaseService = new NeteaseMusicService()
export const qqService = new QQMusicService()

export function serviceFor(source: MusicSource): MusicService {
  return source === 'qq' ? qqService : neteaseService
}
