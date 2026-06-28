import { usePlayerStore } from '../../stores/player'
import { usePlaylistStore } from '../../stores/playlist'
import { Slider } from '../ui/Slider'
import { PlayerGlass } from './PlayerGlass'
import { TrackInfo } from './TrackInfo'
import { QualityBadge } from './QualityBadge'
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

/** 播放栏主组件：组合 TrackInfo + 播放控制 + 音量 + 音质徽标，置于底部毛玻璃容器内。 */
export function PlayerBar() {
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
          <TrackInfo />
        </div>

        <div className={styles.center}>
          <div className={styles.buttons}>
            <button type="button" className={`${styles.btn} no-drag`} onClick={prev} title="上一首" aria-label="上一首">
              <PrevIcon />
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.playBtn} no-drag`}
              onClick={toggle}
              title={isPlaying ? '暂停' : '播放'}
              aria-label={isPlaying ? '暂停' : '播放'}
              data-loading={isLoading}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button type="button" className={`${styles.btn} no-drag`} onClick={next} title="下一首" aria-label="下一首">
              <NextIcon />
            </button>
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
            <span className={styles.volumeIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9zM16 8.5a4 4 0 0 1 0 7v-7z" />
              </svg>
            </span>
            <Slider
              className={styles.volumeSlider}
              value={volume}
              min={0}
              max={1}
              step={0.01}
              onChange={setVolume}
            />
          </div>
          <QualityBadge />
        </div>
      </div>
    </PlayerGlass>
  )
}
