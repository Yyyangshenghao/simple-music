import { useMemo } from 'react'
import { serviceFor } from '../lib/service-registry'
import type { MusicService } from '../lib/music-service'
import type { MusicSource } from '../types/domain'

/** 显式绑定数据所属平台，避免组件隐式依赖全局二选一音源。 */
export function useMusicService(source: MusicSource): MusicService {
  return useMemo(() => serviceFor(source), [source])
}
