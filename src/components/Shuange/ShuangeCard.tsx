import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { tapScale } from '../../lib/motion-presets'
import { sizedImage } from '../../lib/image-size'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { SHUANGE_COVER_PX, useShuangeStore } from '../../stores/shuange'
import { usePlayerStore } from '../../stores/player'
import { useLyricsStore } from '../../stores/lyrics'
import { useLikesStore, likeKeyOf } from '../../stores/likes'
import { HeartIcon } from '../ui/HeartIcon'
import { CloseIcon } from '../ui/CloseIcon'
import type { Track } from '../../types/domain'
import styles from './ShuangeCard.module.css'

interface ShuangeCardProps {
  track: Track
  switching: boolean
  onExit(): void
}

function trackKey(track: Track | null): string {
  return track ? `${track.source}:${String(track.id)}` : ''
}

function PlayIcon({ paused }: { paused: boolean }) {
  return paused ? (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
  )
}

function StepIcon({ up }: { up: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg>
}

function RefreshIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-4M4 5v4h4m-4 4a8 8 0 0 0 14.9 4M20 19v-4h-4" /></svg>
}

function ClipProgress({ track, startSec, endSec }: { track: Track; startSec: number; endSec: number }) {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const position = usePlayerStore((s) => s.position)
  const duration = endSec - startSec
  const progress = trackKey(track) === trackKey(currentTrack) && duration > 0
    ? Math.max(0, Math.min(1, (position - startSec) / duration))
    : 0
  return (
    <div className={styles.progress} aria-label="精彩片段播放进度">
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  )
}

export function ShuangeCard({ track, switching, onExit }: ShuangeCardProps) {
  const titleViewportRef = useRef<HTMLHeadingElement>(null)
  const titleTextRef = useRef<HTMLSpanElement>(null)
  const [titleOverflow, setTitleOverflow] = useState(false)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const status = usePlayerStore((s) => s.status)
  const toggle = usePlayerStore((s) => s.toggle)
  const index = useShuangeStore((s) => s.index)
  const offset = useShuangeStore((s) => s.offset)
  const refreshError = useShuangeStore((s) => s.error)
  const next = useShuangeStore((s) => s.next)
  const prev = useShuangeStore((s) => s.prev)
  const playFull = useShuangeStore((s) => s.playFullCurrent)
  const notInterested = useShuangeStore((s) => s.notInterestedCurrent)
  const lines = useLyricsStore((s) => s.lines)
  const lyricsTrackKey = useLyricsStore((s) => s.trackKey)
  const currentIndex = useLyricsStore((s) => s.currentIndex)
  const liked = useLikesStore((s) => s.likedByKey[likeKeyOf(track)] ?? false)
  const supports = useLikesStore((s) => s.supports)
  const matchesPlayer = trackKey(track) === trackKey(currentTrack)
  const matchesLyrics = lyricsTrackKey === trackKey(track)
  const currentLine = matchesPlayer && matchesLyrics && currentIndex >= 0 ? lines[currentIndex]?.text : ''
  const nextLine = matchesPlayer && matchesLyrics && currentIndex >= 0 ? lines[currentIndex + 1]?.text : ''
  const clipDuration = offset ? offset.endSec - offset.startSec : 0
  const isPlaying = matchesPlayer && status === 'playing'
  const buffering = switching || (matchesPlayer && status === 'loading')
  const cover = track.cover ? sizedImage(track.cover, SHUANGE_COVER_PX) : ''

  useEffect(() => {
    void useLikesStore.getState().ensureChecked(track)
  }, [track])

  useEffect(() => {
    const viewport = titleViewportRef.current
    const text = titleTextRef.current
    if (!viewport || !text) return
    const measure = () => setTitleOverflow(text.getBoundingClientRect().width > viewport.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(text)
    return () => observer.disconnect()
  }, [track.name])

  return (
    <article className={styles.card}>
      {cover && <div className={styles.backdrop} style={{ backgroundImage: `url("${cover}")` }} aria-hidden="true" />}
      <div className={styles.backdropShade} aria-hidden="true" />

      <header className={styles.header}>
        <div className={styles.eyebrow}><span>DISCOVERY CUT</span><i />{SOURCE_BRAND[track.source].label}</div>
        <motion.button
          type="button"
          className={`${styles.refreshAction} no-drag`}
          onClick={() => void useShuangeStore.getState().refresh()}
          disabled={switching}
          whileTap={tapScale}
          aria-label={refreshError ? `换一批：${refreshError}` : '换一批'}
          title={refreshError || '换一批'}
        >
          <RefreshIcon />
          {refreshError ? '暂无新歌' : '换一批'}
        </motion.button>
      </header>

      <div className={styles.stage}>
        <div className={`${styles.coverStage}${isPlaying ? ` ${styles.coverPlaying}` : ''}`}>
          <div className={styles.coverGlow} aria-hidden="true" />
          {cover ? <img className={styles.cover} src={cover} alt={`${track.name} 封面`} draggable={false} decoding="async" fetchPriority="high" /> : <div className={styles.coverFallback}>♪</div>}
          <button
            type="button"
            className={`${styles.coverPlay} no-drag`}
            onClick={() => { if (!buffering && matchesPlayer) toggle() }}
            disabled={buffering || !matchesPlayer}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            <PlayIcon paused={!isPlaying} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.clipBadge}>
            <span className={styles.liveDot} />
            {switching ? '正在定位精彩段' : status === 'loading' ? '正在缓冲片段' : offset?.kind === 'refrain' ? '重复段精选' : '歌曲结构精选'}
          </div>
          <h1 ref={titleViewportRef} title={track.name}>
            <span className={styles.titleTrack} data-overflow={titleOverflow}>
              <span ref={titleTextRef}>{track.name}</span>
              {titleOverflow && <><span className={styles.titleGap} aria-hidden="true" /> <span aria-hidden="true">{track.name}</span></>}
            </span>
          </h1>
          <p className={styles.artist}>{track.artist || '未知歌手'}</p>

          <div className={styles.lyric} aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${trackKey(track)}-${currentIndex}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.24 }}
              >
                <strong>{currentLine || (switching ? '先等一拍，马上开唱' : '听听这一段')}</strong>
                <span>{nextLine || '喜欢的话，可以收藏或播放全曲'}</span>
              </motion.div>
            </AnimatePresence>
          </div>

          <ClipProgress track={track} startSec={offset?.startSec ?? 0} endSec={offset?.endSec ?? 0} />
          <div className={styles.progressMeta}>
            <span>{offset?.kind === 'refrain' ? '副歌候选' : '精彩片段'}</span>
            <span>{Math.round(clipDuration || 30)} 秒循环</span>
          </div>

          <div className={styles.actions}>
            {supports(track) && (
              <motion.button
                type="button"
                className={`${styles.iconAction} no-drag`}
                data-liked={liked}
                onClick={() => void useShuangeStore.getState().toggleLike(track)}
                whileTap={tapScale}
                aria-label={liked ? '取消喜欢' : '喜欢'}
                title={liked ? '取消喜欢 (L)' : '喜欢 (L)'}
              >
                <HeartIcon filled={liked} size={19} />
              </motion.button>
            )}
            <motion.button
              type="button"
              className={`${styles.dismissAction} no-drag`}
              onClick={() => void notInterested()}
              disabled={switching}
              whileTap={tapScale}
              title="不感兴趣"
            >
              不感兴趣
            </motion.button>
            <motion.button type="button" className={`${styles.fullAction} no-drag`} onClick={playFull} whileTap={tapScale}>
              播放全曲
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
            </motion.button>
            <motion.button type="button" className={`${styles.iconAction} no-drag`} onClick={onExit} whileTap={tapScale} aria-label="退出刷歌" title="退出 (Esc)">
              <CloseIcon size={17} />
            </motion.button>
          </div>
        </div>
      </div>

      <nav className={styles.stepRail} aria-label="切换歌曲">
        <button type="button" className="no-drag" onClick={() => void prev()} disabled={index <= 0 || switching} aria-label="上一首"><StepIcon up /></button>
        <span />
        <button type="button" className="no-drag" onClick={() => void next()} disabled={switching} aria-label="下一首"><StepIcon up={false} /></button>
      </nav>

      <div className={styles.gestureHint} aria-hidden="true"><span />滚轮或上下拖动切歌</div>
    </article>
  )
}
