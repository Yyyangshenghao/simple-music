import { useEffect, useState } from 'react'
import { useMusicService } from '../../hooks/useMusicService'
import { CardRail } from './CardRail'
import { PlaylistCard } from './PlaylistCard'
import type { Playlist } from '../../types/domain'

interface ToplistRailProps {
  onOpen(playlist: Playlist): void
}

/** 官方榜单(飙升榜/新歌榜/热歌榜等)横向陈列;可选实现,未实现的音源(QQ)整栏不渲染。
 *  榜单本身就是歌单,点开复用 PlaylistDetailView,TrackRow 自带序号天然呈现"排行"观感。 */
export function ToplistRail({ onOpen }: ToplistRailProps) {
  const service = useMusicService()
  const [playlists, setPlaylists] = useState<Playlist[]>([])

  useEffect(() => {
    // 音源切换时丢弃在途响应
    let cancelled = false
    setPlaylists([])
    service.getToplists?.()
      .then((pls) => { if (!cancelled) setPlaylists(pls) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [service])

  if (playlists.length === 0) return null

  return (
    <CardRail title="排行榜">
      {playlists.map((pl) => (
        <PlaylistCard key={String(pl.id)} playlist={pl} onClick={() => onOpen(pl)} />
      ))}
    </CardRail>
  )
}
