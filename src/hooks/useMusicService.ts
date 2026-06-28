import { useMemo } from 'react'
import { useSettingsStore } from '../stores/settings'
import { NeteaseMusicService } from '../lib/netease-music-service'
import { QQMusicService } from '../lib/qq-music-service'
import type { MusicService } from '../lib/music-service'

const netease = new NeteaseMusicService()
const qq = new QQMusicService()

export function useMusicService(): MusicService {
  const activeSource = useSettingsStore((s) => s.activeSource)
  return useMemo(() => (activeSource === 'qq' ? qq : netease), [activeSource])
}
