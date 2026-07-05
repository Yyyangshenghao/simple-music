import { useMemo } from 'react'
import { useSettingsStore } from '../stores/settings'
import { neteaseService, qqService } from '../lib/service-registry'
import type { MusicService } from '../lib/music-service'

export function useMusicService(): MusicService {
  const activeSource = useSettingsStore((s) => s.activeSource)
  return useMemo(() => (activeSource === 'qq' ? qqService : neteaseService), [activeSource])
}
