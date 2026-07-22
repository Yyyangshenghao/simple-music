import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { usePlaylistStore } from '../../stores/playlist'
import { useSettingsStore } from '../../stores/settings'
import { useLikesStore, likeKeyOf } from '../../stores/likes'
import { tapScale, springSnappy, iconSwap } from '../../lib/motion-presets'
import type { PlayMode } from '../../types/domain'
import { Slider } from '../ui/Slider'
import { ElasticSlider } from '../ui/ElasticSlider'
import { PlayerGlass } from './PlayerGlass'
import { TrackInfo } from './TrackInfo'
import { QualityBadge } from './QualityBadge'
import { RateBadge } from './RateBadge'
import { SourceFallbackBadge } from './SourceFallbackBadge'
import { QueuePanel } from './QueuePanel'
import { SleepTimerButton } from './SleepTimerButton'
import styles from './PlayerBar.module.css'

/** 秒数格式化为 mm:ss；非有限值归零。 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M7 6h2v12H7zM20 6v12l-9-6z" />
    </svg>
  )
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M15 6h2v12h-2zM4 6l9 6-9 6z" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  )
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

function RepeatOneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
      <path d="M11 10h2v5" strokeWidth="2.2" />
    </svg>
  )
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 3h5v5" />
      <path d="M4 20L21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6" />
      <path d="M4 4l5 5" />
    </svg>
  )
}

/** 音量图标:喇叭主体常驻不跳变,音波弧线与静音斜线按音量档位各自淡入淡出。 */
function VolumeIcon({ level }: { level: 'mute' | 'low' | 'high' }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9z" fill="currentColor" />
      <motion.path
        d="M16 8.5a4 4 0 0 1 0 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        style={{ transformOrigin: '14px 12px' }}
        animate={{ opacity: level === 'mute' ? 0 : 1, scale: level === 'mute' ? 0.6 : 1 }}
        transition={iconSwap}
      />
      <motion.path
        d="M19 6a9 9 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        style={{ transformOrigin: '17px 12px' }}
        animate={{ opacity: level === 'high' ? 1 : 0, scale: level === 'high' ? 1 : 0.6 }}
        transition={iconSwap}
      />
      <motion.path
        d="M15.5 9.5l5 5m0-5l-5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        style={{ transformOrigin: '18px 12px' }}
        animate={{ opacity: level === 'mute' ? 1 : 0, scale: level === 'mute' ? 1 : 0.6 }}
        transition={iconSwap}
      />
    </svg>
  )
}

/** 音量按钮:静音切换,图标随音量档位淡入淡出。 */
function VolumeButton() {
  const volume = usePlayerStore((s) => s.volume)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const lastVolumeRef = useRef(volume > 0 ? volume : 0.8)
  if (volume > 0) lastVolumeRef.current = volume

  const level = volume <= 0 ? 'mute' : volume < 0.5 ? 'low' : 'high'

  return (
    <motion.button
      type="button"
      className={`${styles.btn} ${styles.volumeBtn} no-drag`}
      onClick={() => setVolume(volume > 0 ? 0 : lastVolumeRef.current)}
      title={volume > 0 ? '静音' : '取消静音'}
      aria-label={volume > 0 ? '静音' : '取消静音'}
      whileTap={tapScale}
      transition={springSnappy}
    >
      <span className={styles.volumeIconWrap}>
        <VolumeIcon level={level} />
      </span>
    </motion.button>
  )
}

/** 迷你播放条图标:画中画式的小窗示意。 */
function MiniPlayerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <rect x="12" y="12" width="7" height="5" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 迷你悬浮播放条开关:切换独立的置顶 overlay 窗口。 */
function MiniPlayerButton() {
  const enabled = useSettingsStore((s) => s.miniPlayerEnabled)
  return (
    <motion.button
      type="button"
      className={`${styles.btn} ${styles.miniPlayerBtn} no-drag`}
      data-active={enabled}
      onClick={() => {
        const next = !enabled
        const { miniPlayerWidth } = useSettingsStore.getState()
        useSettingsStore.getState().setMiniPlayerEnabled(next)
        void window.desktop?.setMiniPlayerEnabled(next, miniPlayerWidth)
      }}
      title={enabled ? '关闭迷你播放条' : '开启迷你播放条'}
      aria-label={enabled ? '关闭迷你播放条' : '开启迷你播放条'}
      aria-pressed={enabled}
      whileTap={tapScale}
      transition={springSnappy}
    >
      <MiniPlayerIcon />
    </motion.button>
  )
}

const MODE_CYCLE: Record<PlayMode, PlayMode> = { order: 'shuffle', shuffle: 'one', one: 'order' }
const MODE_LABEL: Record<PlayMode, string> = { order: '列表循环', shuffle: '随机播放', one: '单曲循环' }

/** 播放模式切换按钮:列表循环 → 随机 → 单曲循环 循环切换,模式持久化在 settings。 */
function PlayModeButton() {
  const playMode = useSettingsStore((s) => s.playMode)
  const label = MODE_LABEL[playMode]
  return (
    <motion.button
      type="button"
      className={`${styles.btn} ${styles.modeBtn} no-drag`}
      data-mode={playMode}
      onClick={() => useSettingsStore.getState().setPlayMode(MODE_CYCLE[playMode])}
      title={label}
      aria-label={`播放模式:${label}`}
      whileTap={tapScale}
      transition={springSnappy}
    >
      {playMode === 'shuffle' ? <ShuffleIcon /> : playMode === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
    </motion.button>
  )
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

/** 当前曲目红心:音源支持且已登录时显示,乐观切换。 */
function LikeButton() {
  const track = usePlayerStore((s) => s.currentTrack)
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const liked = useLikesStore((s) => (track ? !!s.likedByKey[likeKeyOf(track)] : false))
  const supported = !!track && useLikesStore.getState().supports(track)
  const visible = supported && (track?.source !== 'netease' || neteaseLoggedIn)

  useEffect(() => {
    if (track && visible) void useLikesStore.getState().ensureChecked(track)
  }, [track, visible])

  if (!track || !visible) return null
  return (
    <motion.button
      type="button"
      className={`${styles.btn} ${styles.likeBtn} no-drag`}
      data-liked={liked}
      onClick={() => void useLikesStore.getState().toggleLike(track)}
      title={liked ? '取消红心' : '红心'}
      aria-label={liked ? '取消红心' : '红心'}
      whileTap={tapScale}
      transition={springSnappy}
    >
      <HeartIcon filled={liked} />
    </motion.button>
  )
}

interface PlayerBarProps {
  onOpenLyrics?: () => void
  /** 沉浸模式:淡出整个播放栏(布局占位不变) */
  hidden?: boolean
}

/** 播放栏主组件：组合 TrackInfo + 播放控制 + 音量 + 音质徽标，置于底部毛玻璃容器内。 */
export function PlayerBar({ onOpenLyrics, hidden }: PlayerBarProps) {
  const status = usePlayerStore((s) => s.status)
  const position = usePlayerStore((s) => s.position)
  const duration = usePlayerStore((s) => s.duration)
  const volume = usePlayerStore((s) => s.volume)
  const toggle = usePlayerStore((s) => s.toggle)
  const seek = usePlayerStore((s) => s.seek)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const next = usePlaylistStore((s) => s.next)
  const prev = usePlaylistStore((s) => s.prev)

  const isPlaying = status === 'playing'
  const isLoading = status === 'loading'

  return (
    <PlayerGlass hidden={hidden}>
      <div className={styles.bar}>
        <div className={styles.left}>
          <TrackInfo onCoverClick={onOpenLyrics} />
          <LikeButton />
        </div>

        <div className={styles.center}>
          <div className={styles.buttons}>
            <PlayModeButton />
            <motion.button type="button" className={`${styles.btn} no-drag`} onClick={prev} title="上一首" aria-label="上一首" whileTap={tapScale} transition={springSnappy}>
              <PrevIcon />
            </motion.button>
            <motion.button
              type="button"
              className={`${styles.btn} ${styles.playBtn} no-drag`}
              onClick={toggle}
              title={isPlaying ? '暂停' : '播放'}
              aria-label={isPlaying ? '暂停' : '播放'}
              data-loading={isLoading}
              whileTap={tapScale}
              transition={springSnappy}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={isPlaying ? 'pause' : 'play'}
                  className={styles.playIconWrap}
                  initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.6, rotate: 20 }}
                  transition={iconSwap}
                >
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <motion.button type="button" className={`${styles.btn} no-drag`} onClick={next} title="下一首" aria-label="下一首" whileTap={tapScale} transition={springSnappy}>
              <NextIcon />
            </motion.button>
          </div>

          <div className={styles.progress}>
            <span className={styles.time}>{formatTime(position)}</span>
            <Slider
              className={styles.progressSlider}
              value={position}
              min={0}
              max={duration > 0 ? duration : 1}
              step={1}
              onChange={seek}
            />
            <span className={styles.time}>{formatTime(duration)}</span>
          </div>
        </div>

        <div className={styles.right}>
          <div className={styles.volumeGroup}>
            <VolumeButton />
            <ElasticSlider
              className={styles.volumeSlider}
              leftIcon={null}
              rightIcon={null}
              defaultValue={Math.round(volume * 100)}
              startingValue={0}
              maxValue={100}
              onChange={(v) => setVolume(v / 100)}
            />
          </div>
          <span className={styles.divider} aria-hidden="true" />
          <MiniPlayerButton />
          <SleepTimerButton />
          <QueuePanel />
          <SourceFallbackBadge />
          <RateBadge />
          <QualityBadge />
        </div>
      </div>
    </PlayerGlass>
  )
}
