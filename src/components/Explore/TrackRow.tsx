import { useEffect } from 'react'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useLikesStore, likeKeyOf } from '../../stores/likes'
import { formatDuration } from '../../lib/format-duration'
import type { Track } from '../../types/domain'
import styles from './TrackRow.module.css'
import { sizedImage } from '../../lib/image-size'
import { HeartIcon } from '../ui/HeartIcon'

interface TrackRowProps {
  track: Track
  index?: number
  onPlay(): void
}

/** 播放中指示：3 根氛围色动画柱，暂停时定格。 */
function EqIndicator({ paused }: { paused: boolean }) {
  return (
    <span className={`${styles.eq}${paused ? ` ${styles.eqPaused}` : ''}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  )
}

export function TrackRow({ track, index, onPlay }: TrackRowProps) {
  // 窄布尔 selector：只在"是否当前曲目/是否播放中"变化时重渲染，不受高频 position 更新影响
  const isCurrent = usePlayerStore(
    (s) => s.currentTrack?.provider === track.provider && String(s.currentTrack?.id) === String(track.id)
  )
  const isPlaying = usePlayerStore(
    (s) =>
      s.status === 'playing' &&
      s.currentTrack?.provider === track.provider &&
      String(s.currentTrack?.id) === String(track.id)
  )

  // 逐行红心:音源支持且已登录时显示。supports 只取决于 track.source(不变),用 getState 非响应式取即可。
  const liked = useLikesStore((s) => !!s.likedByKey[likeKeyOf(track)])
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const supported = useLikesStore.getState().supports(track)
  const visible = supported && (track.source !== 'netease' || neteaseLoggedIn)

  // 首次渲染该行时回查服务端红心状态(已知 key 在 store 内跳过,不会重复请求)
  useEffect(() => {
    if (visible) void useLikesStore.getState().ensureChecked(track)
  }, [track, visible])

  return (
    <button className={`${styles.row}${isCurrent ? ` ${styles.rowActive}` : ''} no-drag`} onClick={onPlay}>
      {index !== undefined && (
        isCurrent
          ? <EqIndicator paused={!isPlaying} />
          : <span className={styles.index}>{index + 1}</span>
      )}
      {track.cover && <img className={styles.cover} src={sizedImage(track.cover, 96)} alt="" loading="lazy" />}
      <div className={styles.info}>
        <span className={styles.name}>{track.name}</span>
        <span className={styles.artist}>{track.artist}</span>
      </div>
      <span className={styles.duration}>
        {formatDuration(track.duration)}
      </span>
      {visible && (
        <span
          className={`${styles.likeBtn} no-drag`}
          role="button"
          tabIndex={0}
          data-liked={liked}
          title={liked ? '取消红心' : '红心'}
          aria-label={liked ? '取消红心' : '红心'}
          onClick={(e) => {
            e.stopPropagation()
            void useLikesStore.getState().toggleLike(track)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              void useLikesStore.getState().toggleLike(track)
            }
          }}
        >
          <HeartIcon filled={liked} size={16} />
        </span>
      )}
    </button>
  )
}
