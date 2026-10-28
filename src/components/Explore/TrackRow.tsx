import { useContext, useEffect, useRef } from 'react'
import { ListScrollActivity } from '../ui/list-scroll-activity'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useLikesStore, likeKeyOf } from '../../stores/likes'
import { formatDuration } from '../../lib/format-duration'
import type { Track } from '../../types/domain'
import styles from './TrackRow.module.css'
import { sizedImage } from '../../lib/image-size'
import { HeartIcon } from '../ui/HeartIcon'
import { EqIndicator } from '../ui/EqIndicator'
import { SourceBadge } from '../ui/SourceBadge'
import { offlineTrackKey, type OfflineCacheStatus } from '../../lib/offline-cache'
import { useOfflineCacheStore } from '../../stores/offline-cache'
import { anchorOf, useTrackActionsStore } from '../../stores/track-actions'

interface TrackRowProps {
  track: Track
  index?: number
  onPlay(): void
  disabled?: boolean
  statusLabel?: string
  hideLikeAction?: boolean
  hideOfflineAction?: boolean
  hideCover?: boolean
  /** 同源列表（平台歌单/专辑）里每行来源徽标是重复信息。 */
  hideSource?: boolean
  showInactiveSource?: boolean
  /** 列表混有不可播放原因时开启：时长与原因共用定宽列，专辑列逐行对齐。 */
  statusColumn?: boolean
}

function OfflineIcon({ state }: { state: 'missing' | 'cached' | 'pinned' }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 18.5h14" strokeLinecap="round" />
      {state === 'pinned' && <path d="m17 5 1.5 1.5L21 4" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

export function TrackRow({ track, index, onPlay, disabled = false, statusLabel, hideOfflineAction = false, hideLikeAction = false, hideCover = false, hideSource = false, showInactiveSource = false, statusColumn = false }: TrackRowProps) {
  const scrolling = useContext(ListScrollActivity)
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
  const likesRevision = useLikesStore((s) => s.revision)
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const supported = useLikesStore.getState().supports(track)
  const visible = supported && (track.source !== 'netease' || neteaseLoggedIn)
  const offlineKey = offlineTrackKey(track)
  const offline = useOfflineCacheStore((s) => s.byKey[offlineKey])
  const offlineRevision = useOfflineCacheStore((s) => s.revision)
  // 缓存淘汰只释放全局记录；已显示的徽标保留到行卸载或缓存主动失效。
  const lastOffline = useRef<{ key: string; revision: number; status?: OfflineCacheStatus }>({ key: offlineKey, revision: offlineRevision, status: offline })
  if (lastOffline.current.key !== offlineKey || lastOffline.current.revision !== offlineRevision) {
    lastOffline.current = { key: offlineKey, revision: offlineRevision, status: offline }
  } else if (offline) {
    lastOffline.current.status = offline
  }
  const visibleOffline = offline ?? lastOffline.current.status
  const offlineVisible = track.source === 'netease' || track.source === 'qq'

  // 首次渲染该行时回查服务端红心状态(已知 key 在 store 内跳过,不会重复请求)
  useEffect(() => {
    if (visible && !scrolling) void useLikesStore.getState().ensureChecked(track)
  }, [track, visible, likesRevision, scrolling])
  useEffect(() => {
    if (offlineVisible && !scrolling) void useOfflineCacheStore.getState().ensure(track)
  }, [offlineVisible, track.source, track.id, offlineRevision, scrolling])

  return (
    <div
      className={`${styles.row}${isCurrent ? ` ${styles.rowActive}` : ''} no-drag`}
      onContextMenu={(e) => {
        e.preventDefault()
        useTrackActionsStore.getState().openMenu(track, { x: e.clientX, y: e.clientY, width: 0, height: 0 })
      }}
    >
      <button type="button" className={styles.playArea} onClick={onPlay} disabled={disabled} title={statusLabel}>
        {index !== undefined && (
          isCurrent
            ? <EqIndicator paused={!isPlaying} />
            : <span className={styles.indexCell}>
              <span className={styles.index}>{index + 1}</span>
              {!disabled && <svg className={styles.playGlyph} viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>}
            </span>
        )}
        {/* 无封面时留同尺寸占位，混排（本地歌曲等）时标题列仍对齐。 */}
        {!hideCover && (track.cover
          ? <img className={styles.cover} src={sizedImage(track.cover, 96)} alt="" loading="lazy" />
          : <span className={`${styles.cover} ${styles.coverEmpty}`} aria-hidden="true" />)}
        <div className={styles.info}>
          <span className={styles.name}>{track.name}</span>
          <span className={styles.artistLine}>
            <span className={styles.artist}>{track.artist}</span>
            {!hideSource && <SourceBadge source={track.source} compact showInactive={showInactiveSource} displayMode={showInactiveSource ? 'always' : undefined} />}
          </span>
        </div>
        {/* 专辑列只在宽行显示（容器查询）；专辑页本身隐藏封面时不重复。 */}
        {!hideCover && track.album && <span className={styles.album}>{track.album}</span>}
        {statusLabel
          ? <span className={`${styles.status}${statusColumn ? ` ${styles.metaColumn}` : ''}`}>{statusLabel}</span>
          : track.duration ? <span className={`${styles.duration}${statusColumn ? ` ${styles.metaColumn}` : ''}`}>{formatDuration(track.duration)}</span>
          : statusColumn ? <span className={styles.metaColumn} aria-hidden="true" /> : null}
      </button>
      <button
        type="button"
        className={`${styles.addBtn} no-drag`}
        data-track-action-trigger
        title="加入歌单"
        aria-label="加入歌单"
        aria-haspopup="dialog"
        onClick={(e) => {
          e.stopPropagation()
          useTrackActionsStore.getState().toggleQuickAdd(track, anchorOf(e.currentTarget))
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      {/* 离线、红心按需出现；不适用的行保留同宽空位，专辑列不随按钮数量左右漂移。 */}
      {!hideOfflineAction && (offlineVisible && !disabled ? (
        <button
          type="button"
          className={styles.offlineBtn}
          data-state={visibleOffline?.state ?? 'missing'}
          title={visibleOffline?.state === 'pinned' ? '已保存为离线音乐，点击取消离线保存' : visibleOffline?.state === 'cached' ? '已自动缓存，点击下载歌曲' : '下载歌曲'}
          aria-label={visibleOffline?.state === 'pinned' ? '取消离线保存' : '下载歌曲'}
          onClick={(e) => {
            e.stopPropagation()
            if (visibleOffline?.state === 'pinned') void useOfflineCacheStore.getState().setPinned(track, false)
            else void useOfflineCacheStore.getState().save(track)
          }}
        >
          <OfflineIcon state={visibleOffline?.state ?? 'missing'} />
        </button>
      ) : <span className={styles.actionSlot} aria-hidden="true" />)}
      {!hideLikeAction && (visible && !disabled ? (
        <button
          type="button"
          className={`${styles.likeBtn} no-drag`}
          data-liked={liked}
          title={liked ? '取消红心' : '红心'}
          aria-label={liked ? '取消红心' : '红心'}
          onClick={(e) => {
            e.stopPropagation()
            void useLikesStore.getState().toggleLike(track)
          }}
        >
          <HeartIcon filled={liked} size={16} />
        </button>
      ) : <span className={styles.actionSlot} aria-hidden="true" />)}
    </div>
  )
}
