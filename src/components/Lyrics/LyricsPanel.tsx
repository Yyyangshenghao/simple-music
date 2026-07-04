import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { useLyricsStore } from '../../stores/lyrics'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useVisualStore } from '../../stores/visual'
import { LyricLine } from './LyricLine'
import { KtvLine } from './KtvLine'
import { CoverParticleCloud } from '../Visualizer/CoverParticleCloud'
import { CinemaCamera } from '../Visualizer/CinemaCamera'
import styles from './LyricsPanel.module.css'

interface LyricsPanelProps {
  open: boolean
  onClose: () => void
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 7 10 13 16 7" />
    </svg>
  )
}

export function LyricsPanel({ open, onClose }: LyricsPanelProps) {
  const track = usePlayerStore((s) => s.currentTrack)
  const status = usePlayerStore((s) => s.status)
  const lines = useLyricsStore((s) => s.lines)
  const translation = useLyricsStore((s) => s.translation)
  const currentIndex = useLyricsStore((s) => s.currentIndex)
  const wordLines = useLyricsStore((s) => s.wordLines)           // added by Agent A
  const currentCharProgress = useLyricsStore((s) => s.currentCharProgress) // added by Agent A
  const mode = useSettingsStore((s) => s.lyricsPanelMode)        // added by Agent A
  const setMode = useSettingsStore((s) => s.setLyricsPanelMode)  // added by Agent A
  const backgroundColor = useVisualStore((s) => s.fx.backgroundColor)

  const scrollRef = useRef<HTMLDivElement>(null)
  const isPlaying = status === 'playing'

  // 平滑滚动到当前行（仅纯歌词模式）
  useEffect(() => {
    if (mode !== 'lyrics') return
    const container = scrollRef.current
    if (!container || currentIndex < 0 || !open) return
    const el = container.querySelector<HTMLElement>(`[data-line='${currentIndex}']`)
    if (!el) return
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top, behavior: 'smooth' })
  }, [currentIndex, open, mode])

  // 面板打开时立即定位
  useEffect(() => {
    if (!open || mode !== 'lyrics') return
    const container = scrollRef.current
    if (!container || currentIndex < 0) return
    const el = container.querySelector<HTMLElement>(`[data-line='${currentIndex}']`)
    if (!el) return
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top, behavior: 'instant' })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 当前行的逐字数据
  const currentWordLine = currentIndex >= 0 ? wordLines[currentIndex] : undefined
  const nextWordLine = currentIndex >= 0 ? wordLines[currentIndex + 1] : undefined
  const nextTranslation = currentIndex >= 0 ? translation[currentIndex + 1]?.text : undefined

  return (
    <div className={`${styles.panel}${open ? ` ${styles.open}` : ''}`}>
      {/* Header：始终显示 */}
      <div className={styles.header}>
        <button className={`${styles.closeBtn} no-drag`} onClick={onClose} aria-label="收起歌词">
          <span className={styles.closeBtnIcon}><ChevronDown /></span>
          收起
        </button>

        {/* 模式切换 Segmented Control */}
        <div className={`${styles.modeSwitch} no-drag`}>
          <button
            className={`${styles.modeBtn}${mode === 'lyrics' ? ` ${styles.modeBtnActive}` : ''}`}
            onClick={() => setMode('lyrics')}
          >
            歌词
          </button>
          <button
            className={`${styles.modeBtn}${mode === '3d' ? ` ${styles.modeBtnActive}` : ''}`}
            onClick={() => setMode('3d')}
          >
            3D
          </button>
        </div>
      </div>

      {/* ===== 纯歌词模式 ===== */}
      {mode === 'lyrics' && (
        <>
          {/* 封面模糊背景 */}
          {track?.cover && (
            <div
              className={styles.blurBg}
              style={{ backgroundImage: `url(${track.cover})` }}
            />
          )}

          {/* 氛围霞光舞台：两团氛围色缓慢漂移，跟切歌变色 */}
          <div className={styles.auroraStage} aria-hidden="true" />

          <div className={styles.coverSection}>
            <div className={styles.coverWrap}>
              {track?.cover ? (
                <img
                  className={`${styles.coverArt}${isPlaying ? ` ${styles.spinning}` : ''}`}
                  src={track.cover}
                  alt={track.name}
                  draggable={false}
                />
              ) : (
                <div className={styles.coverPlaceholder} aria-hidden="true">♪</div>
              )}
              <div className={styles.vinylHole} aria-hidden="true" />
            </div>
            <div className={styles.trackMeta}>
              <div className={styles.trackName} title={track?.name}>
                {track?.name ?? '未在播放'}
              </div>
              <div className={styles.artistName} title={track?.artist}>
                {track?.artist ?? '—'}
              </div>
            </div>
          </div>

          {lines.length === 0 ? (
            <div className={styles.empty}>暂无歌词</div>
          ) : (
            <div className={styles.lyricsScroll} ref={scrollRef}>
              <div className={styles.lyricsPad} aria-hidden="true" />
              {lines.map((line, i) => {
                const isActive = i === currentIndex
                const wordLine = wordLines[i]

                if (isActive && wordLine) {
                  return (
                    <div
                      key={`${line.time}-${i}`}
                      data-line={i}
                      className={styles.ktvLineWrap}
                      style={{ fontSize: '26px', fontWeight: 700 }}
                    >
                      <KtvLine
                        words={wordLine.words}
                        lineDurationMs={wordLine.durationMs}
                        progress={currentCharProgress}
                        active={true}
                        translationText={translation[i]?.text || undefined}
                      />
                    </div>
                  )
                }

                return (
                  <div key={`${line.time}-${i}`} data-line={i}>
                    <LyricLine
                      text={line.text}
                      translation={translation[i]?.text || undefined}
                      active={false}
                    />
                  </div>
                )
              })}
              <div className={styles.lyricsPad} aria-hidden="true" />
            </div>
          )}
        </>
      )}

      {/* ===== 3D 粒子模式 ===== */}
      {mode === '3d' && open && (
        <div className={styles.scene3d}>
          <Canvas
            camera={{ position: [0, 0, 14], fov: 60 }}
            dpr={[1, 1.5]}
            gl={{ antialias: false, alpha: true }}
            style={{ background: backgroundColor || '#04060c' }}
          >
            <CinemaCamera />
            <CoverParticleCloud coverUrl={track?.cover} />
          </Canvas>

          {/* 歌词叠加层：当前行 + 下一行 */}
          <div className={styles.lyricsOverlay}>
            {currentWordLine ? (
              <div className={styles.overlayCurrentLine}>
                <KtvLine
                  words={currentWordLine.words}
                  lineDurationMs={currentWordLine.durationMs}
                  progress={currentCharProgress}
                  active={true}
                  translationText={translation[currentIndex]?.text || undefined}
                />
              </div>
            ) : (
              <div className={styles.overlayPlaceholder}>—</div>
            )}
            {nextWordLine && (
              <div className={styles.overlayNextLine}>
                <KtvLine
                  words={nextWordLine.words}
                  lineDurationMs={nextWordLine.durationMs}
                  progress={0}
                  active={false}
                  dim={false}
                  translationText={nextTranslation || undefined}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
