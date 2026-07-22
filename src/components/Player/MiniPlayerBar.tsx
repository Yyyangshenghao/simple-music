import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { MINI_PLAYER_LYRICS_WIDTH } from '../../lib/mini-player-config'
import type { MiniPlayerAppearance } from '../../types/ipc'
import styles from './MiniPlayerBar.module.css'

interface MiniPlayerBarProps {
  trackTitle?: string
  artistName?: string
  coverUrl?: string
  playing?: boolean
  position?: number
  duration?: number
  volume?: number
  lyricLine?: string
  accent?: string
  appearance: MiniPlayerAppearance
  /** 当前窗口宽度,决定紧凑/展开形态。 */
  width: number
  onTogglePlay?: () => void
  onPrev?: () => void
  onNext?: () => void
  onSeek?: (seconds: number) => void
  onVolume?: (v: number) => void
  onClose?: () => void
  onOpenMain?: () => void
  /** 右边缘手柄拖拽增量(px)。 */
  onResizeBy?: (dx: number) => void
  /** 音量弹层开合:窗口需要随之增高/收回。 */
  onPopoverChange?: (open: boolean) => void
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M7 6h2v12H7zM20 6v12l-9-6z" />
    </svg>
  )
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M15 6h2v12h-2zM4 6l9 6-9 6z" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  )
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9z" fill="currentColor" />
      {muted ? (
        <path d="M15.5 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M16 8.5a4 4 0 0 1 0 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      )}
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** #rrggbb → "r, g, b";解析失败返回 null。 */
function hexToRgbTriple(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const n = parseInt(h, 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

/** 把封面主色压暗成可读底色:与近黑按 0.72 混合,保留色相但不抢文字。 */
function coverBase(accent: string | undefined): string {
  const triple = accent ? hexToRgbTriple(accent) : null
  if (!triple) return '18, 18, 20'
  const [r, g, b] = triple.split(',').map((v) => Number(v.trim()))
  const mix = (c: number, dark: number) => Math.round(c * 0.28 + dark * 0.72)
  return `${mix(r, 14)}, ${mix(g, 14)}, ${mix(b, 16)}`
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * 迷你悬浮播放条（overlay 窗口内用）。
 * 窗口高度固定,底部是播放条本体,上方留白供音量弹层使用；宽度由右边缘手柄拖拽，
 * 超过断点后在信息区与控制区之间腾出歌词行。窗口拖拽由外层容器负责。
 */
export function MiniPlayerBar({
  trackTitle,
  artistName,
  coverUrl,
  playing,
  position = 0,
  duration = 0,
  volume = 1,
  lyricLine,
  accent,
  appearance,
  width,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onVolume,
  onClose,
  onOpenMain,
  onResizeBy,
  onPopoverChange
}: MiniPlayerBarProps) {
  const [volumeOpen, setVolumeOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const resizeOrigin = useRef<number | null>(null)

  const hasTrack = !!trackTitle
  const expanded = width >= MINI_PLAYER_LYRICS_WIDTH
  const showLyrics = expanded && appearance.showLyrics
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0

  const base = appearance.tint === 'light' ? '246, 246, 248' : appearance.tint === 'cover' ? coverBase(accent) : '18, 18, 20'
  const rootStyle = {
    '--mp-base': base,
    '--mp-opacity': String(appearance.opacity),
    '--mp-blur': `${appearance.blur}px`
  } as CSSProperties

  useEffect(() => {
    onPopoverChange?.(volumeOpen)
  }, [volumeOpen, onPopoverChange])

  // 音量弹层:点击条外区域关闭
  useEffect(() => {
    if (!volumeOpen) return
    const onDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setVolumeOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [volumeOpen])

  const handleSeek = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!onSeek || duration <= 0) return
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width <= 0) return
      onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration)
    },
    [onSeek, duration]
  )

  // 手柄拖拽:窗口宽度由主进程改，这里只上报增量,用 screenX 免受窗口自身尺寸变化干扰
  const handleResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    resizeOrigin.current = e.screenX
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handleResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeOrigin.current === null) return
    // 松开键后 pointerup 不一定送得到（窗口 focusable:false，在窗外松开时 macOS 不派发），
    // 只靠 pointerup 清状态会让残留的 origin 把之后每次纯悬停都变成拖拽。
    if (e.buttons === 0) {
      resizeOrigin.current = null
      return
    }
    const dx = e.screenX - resizeOrigin.current
    if (dx === 0) return
    resizeOrigin.current = e.screenX
    onResizeBy?.(dx)
  }
  const handleResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    resizeOrigin.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const stop = (e: ReactPointerEvent) => e.stopPropagation()

  return (
    <div className={styles.root} style={rootStyle} data-tint={appearance.tint}>
      {volumeOpen && (
        <div className={styles.popover} onPointerDown={stop}>
          <VolumeIcon muted={volume <= 0} />
          <input
            className={styles.volumeSlider}
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            onChange={(e) => onVolume?.(Number(e.target.value) / 100)}
            aria-label="音量"
          />
          <span className={styles.volumeValue}>{Math.round(volume * 100)}</span>
        </div>
      )}

      <div className={styles.bar} ref={barRef} data-expanded={expanded}>
        <button
          type="button"
          className={styles.cover}
          onPointerDown={stop}
          onClick={onOpenMain}
          title="回到大播放器"
          aria-label="回到大播放器"
        >
          {coverUrl ? <img src={coverUrl} alt="" draggable={false} /> : <span className={styles.coverPlaceholder} />}
        </button>

        <div className={styles.info}>
          <div className={styles.title}>{hasTrack ? trackTitle : '暂无播放'}</div>
          <div className={styles.artist}>{hasTrack ? artistName : 'Simple Music'}</div>
        </div>

        {showLyrics && (
          <div className={styles.lyricWrap}>
            <div key={lyricLine || 'empty'} className={styles.lyric}>
              {lyricLine || '♪'}
            </div>
          </div>
        )}

        <div className={styles.controls}>
          <button type="button" className={styles.ctl} disabled={!hasTrack} onPointerDown={stop} onClick={onPrev} title="上一首" aria-label="上一首">
            <PrevIcon />
          </button>
          <button
            type="button"
            className={`${styles.ctl} ${styles.ctlPlay}`}
            disabled={!hasTrack}
            onPointerDown={stop}
            onClick={onTogglePlay}
            title={playing ? '暂停' : '播放'}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className={styles.ctl} disabled={!hasTrack} onPointerDown={stop} onClick={onNext} title="下一首" aria-label="下一首">
            <NextIcon />
          </button>
          <button
            type="button"
            className={styles.ctl}
            data-active={volumeOpen}
            onPointerDown={stop}
            onClick={() => setVolumeOpen((v) => !v)}
            title="音量"
            aria-label="音量"
          >
            <VolumeIcon muted={volume <= 0} />
          </button>
          <button type="button" className={`${styles.ctl} ${styles.ctlClose}`} onPointerDown={stop} onClick={onClose} title="收起到托盘" aria-label="收起到托盘">
            <CloseIcon />
          </button>
        </div>

        {appearance.showProgress && (
          <div className={styles.progress} onPointerDown={(e) => { stop(e); handleSeek(e) }} title={`${formatTime(position)} / ${formatTime(duration)}`}>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ transform: `scaleX(${progress})` }} />
            </div>
          </div>
        )}

        <div
          className={styles.resizeHandle}
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onPointerCancel={handleResizeUp}
          title="拖拽调节宽度"
        >
          <span className={styles.grip} />
        </div>
      </div>
    </div>
  )
}
