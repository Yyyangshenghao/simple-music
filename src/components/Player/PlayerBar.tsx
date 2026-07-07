import { motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { usePlaylistStore } from '../../stores/playlist'
import { useSettingsStore } from '../../stores/settings'
import { tapScale, springSnappy } from '../../lib/motion-presets'
import type { PlayMode } from '../../types/domain'
import { Slider } from '../ui/Slider'
import { ElasticSlider } from '../ui/ElasticSlider'
import { PlayerGlass } from './PlayerGlass'
import { TrackInfo } from './TrackInfo'
import { QualityBadge } from './QualityBadge'
import { QueuePanel } from './QueuePanel'
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

interface PlayerBarProps {
  onOpenLyrics?: () => void
}

/** 播放栏主组件：组合 TrackInfo + 播放控制 + 音量 + 音质徽标，置于底部毛玻璃容器内。 */
export function PlayerBar({ onOpenLyrics }: PlayerBarProps) {
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
    <PlayerGlass>
      <div className={styles.bar}>
        <div className={styles.left}>
          <TrackInfo onCoverClick={onOpenLyrics} />
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
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
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
          <div className={styles.volume}>
            <ElasticSlider
              leftIcon={
                <span className={styles.volumeIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9z" />
                  </svg>
                </span>
              }
              rightIcon={
                <span className={styles.volumeIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9zM16 8.5a4 4 0 0 1 0 7v-7zM19 6a9 9 0 0 1 0 12v-2a7 7 0 0 0 0-8z" />
                  </svg>
                </span>
              }
              defaultValue={Math.round(volume * 100)}
              startingValue={0}
              maxValue={100}
              onChange={(v) => setVolume(v / 100)}
            />
          </div>
          <QueuePanel />
          <QualityBadge />
        </div>
      </div>
    </PlayerGlass>
  )
}
