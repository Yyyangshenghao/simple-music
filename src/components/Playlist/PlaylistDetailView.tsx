// 歌单详情共用视图(Library / Explore 共用):
// 全骨架懒加载(useLazyPlaylist)+ 虚拟列表(VirtualList),未加载行显示 shimmer 占位。
// 播放任意一行时按完整 trackIds 入队,未加载详情的为 pending 占位曲目。

import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useScrollGradient } from '../../hooks/useScrollGradient'
import { useLazyPlaylist } from '../../hooks/useLazyPlaylist'
import { useNavigationStore } from '../../stores/navigation'
import { usePlaylistStore } from '../../stores/playlist'
import { GradientText } from '../ui/GradientText'
import { VirtualList } from '../ui/VirtualList'
import { TrackRow } from '../Explore/TrackRow'
import { fadeRise, springGentle, springSnappy, tapScale } from '../../lib/motion-presets'
import type { Playlist, Track } from '../../types/domain'
import styles from './PlaylistDetailView.module.css'

/** TrackRow 实测高度:上下 padding 8×2 + 封面 40。虚拟列表按此定位,改 TrackRow 尺寸需同步。 */
export const TRACK_ROW_HEIGHT = 56

interface PlaylistDetailViewProps {
  playlist: Playlist
  initialTracks?: Track[]
  layoutIdPrefix: 'explore-cover' | 'library-cover'
}

function SkeletonTrackRow({ index }: { index: number }) {
  return (
    <div className={styles.skeletonRow} aria-hidden="true">
      <span className={styles.skeletonIndex}>{index + 1}</span>
      <span className={styles.skeletonCover} />
      <span className={styles.skeletonLines}>
        <i />
        <i />
      </span>
    </div>
  )
}

export function PlaylistDetailView({ playlist, initialTracks, layoutIdPrefix }: PlaylistDetailViewProps) {
  const pageRef = useRef<HTMLDivElement>(null)
  const { topOpacity, bottomOpacity, handleScroll, setTopOpacity, setBottomOpacity } = useScrollGradient()
  const { total, tracks, loading, error, ensureRange, makeQueue, retry } = useLazyPlaylist(playlist, initialTracks)

  // 进入/切换详情时重置滚动渐变遮罩
  useEffect(() => {
    setTopOpacity(0)
    setBottomOpacity(0)
  }, [playlist, setTopOpacity, setBottomOpacity])

  function playAt(index: number) {
    usePlaylistStore.getState().setQueue(makeQueue(), index)
  }

  return (
    <div className={styles.page} ref={pageRef} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />
      <div className={styles.inner}>
        <div className={styles.detailHeader}>
          <motion.button
            className={`${styles.backBtn} no-drag`}
            onClick={() => useNavigationStore.getState().goBack()}
            aria-label="返回上一页"
            whileTap={tapScale}
            transition={springSnappy}
          >
            <svg
              className={styles.backIcon}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>返回</span>
          </motion.button>
          <div className={styles.detailMeta}>
            {playlist.cover && (
              <motion.img
                className={styles.detailCover}
                src={playlist.cover}
                alt=""
                layoutId={`${layoutIdPrefix}-${String(playlist.id)}`}
                transition={springGentle}
              />
            )}
            <motion.div variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
              <h1 className={styles.detailTitle}>
                <GradientText>{playlist.name}</GradientText>
              </h1>
              <p className={styles.detailSub}>{loading ? '加载中…' : `${total} 首`}</p>
            </motion.div>
          </div>
        </div>
        {error ? (
          <div className={styles.errorHint}>
            <p>歌单加载失败</p>
            <button className={`${styles.retryBtn} no-drag`} onClick={retry}>
              重试
            </button>
          </div>
        ) : (
          <motion.div
            className={styles.trackList}
            variants={fadeRise}
            initial="hidden"
            animate="visible"
            transition={{ ...springGentle, delay: 0.15 }}
          >
            <VirtualList
              total={total}
              rowHeight={TRACK_ROW_HEIGHT}
              scrollRef={pageRef}
              onRangeChange={ensureRange}
              renderRow={(i) => {
                const t = tracks[i]
                return t ? <TrackRow track={t} index={i} onPlay={() => playAt(i)} /> : <SkeletonTrackRow index={i} />
              }}
            />
          </motion.div>
        )}
      </div>
      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
    </div>
  )
}
