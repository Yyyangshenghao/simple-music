import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { useLyricsStore } from '../../stores/lyrics'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useVisualStore } from '../../stores/visual'
import { LyricLine } from './LyricLine'
import { KtvLine } from './KtvLine'
import { ArtistLinks } from '../ui/ArtistLinks'
import { CoverParticleCloud } from '../Visualizer/CoverParticleCloud'
import { Waveform3D } from '../Visualizer/Waveform3D'
import { SpeakerParticles } from '../Visualizer/SpeakerParticles'
import { CinemaCamera } from '../Visualizer/CinemaCamera'
import { EffectSwitcher } from './EffectSwitcher'
import type { Lyrics3dEffect } from '../../types/domain'
import styles from './LyricsPanel.module.css'

interface LyricsPanelProps {
  open: boolean
  /** 沉浸模式:淡出 header 控件并隐藏鼠标指针 */
  controlsHidden?: boolean
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

// 3D 效果组件查找表
const EFFECT_COMPONENTS: Record<Lyrics3dEffect, React.FC<{ coverUrl?: string }>> = {
  'cover-cloud': CoverParticleCloud,
  'waveform-3d': Waveform3D,
  'speaker-particles': SpeakerParticles
}

export function LyricsPanel({ open, controlsHidden, onClose }: LyricsPanelProps) {
  const track = usePlayerStore((s) => s.currentTrack)
  const lines = useLyricsStore((s) => s.lines)
  const translation = useLyricsStore((s) => s.translation)
  const currentIndex = useLyricsStore((s) => s.currentIndex)
  const wordLines = useLyricsStore((s) => s.wordLines)           // added by Agent A
  const mode = useSettingsStore((s) => s.lyricsPanelMode)        // added by Agent A
  const setMode = useSettingsStore((s) => s.setLyricsPanelMode)  // added by Agent A
  const backgroundColor = useVisualStore((s) => s.fx.backgroundColor)
  const lyrics3dEffect = useSettingsStore((s) => s.lyrics3dEffect)
  const EffectComponent = EFFECT_COMPONENTS[lyrics3dEffect]

  const scrollRef = useRef<HTMLDivElement>(null)

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
    <div className={`${styles.panel}${open ? ` ${styles.open}` : ''}${controlsHidden ? ` ${styles.immersive}` : ''}`}>
      {/* Header：沉浸模式下淡出 */}
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

          {/* Apple Music 式左右分栏:左侧封面+信息,右侧歌词 */}
          <div className={styles.splitLayout}>
            <div className={styles.coverSection}>
              {track?.cover ? (
                <img
                  className={styles.coverArt}
                  src={track.cover}
                  alt={track.name}
                  draggable={false}
                />
              ) : (
                <div className={styles.coverPlaceholder} aria-hidden="true">♪</div>
              )}
              <div className={styles.trackMeta}>
                <div className={styles.trackName} title={track?.name}>
                  {track?.name ?? '未在播放'}
                </div>
                <ArtistLinks
                  className={styles.artistName}
                  artists={track?.artists}
                  fallback={track?.artist ?? '—'}
                  source={track?.source ?? 'netease'}
                  onBeforeNavigate={onClose}
                />
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

                  // 所有行统一用 KtvLine 渲染：切行时是同一节点上的 CSS 过渡，
                  // 字号一致，激活态只靠 scale/亮度区分
                  if (wordLine) {
                    return (
                      <div key={`${line.time}-${i}`} data-line={i} className={styles.ktvLineWrap}>
                        <KtvLine
                          words={wordLine.words}
                          lineDurationMs={wordLine.durationMs}
                          lineStartMs={wordLine.time * 1000}
                          active={isActive}
                          dim={!isActive}
                          past={i < currentIndex}
                          translationText={translation[i]?.text || undefined}
                          alignLeft
                        />
                      </div>
                    )
                  }

                  return (
                    <div key={`${line.time}-${i}`} data-line={i}>
                      <LyricLine
                        text={line.text}
                        translation={translation[i]?.text || undefined}
                        active={isActive}
                        alignLeft
                      />
                    </div>
                  )
                })}
                <div className={styles.lyricsPad} aria-hidden="true" />
              </div>
            )}
          </div>
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
            <EffectComponent coverUrl={track?.cover} />
          </Canvas>

          {/* 效果切换器（3D 场景内浮动） */}
          <EffectSwitcher hidden={controlsHidden} />

          {/* 歌词叠加层：当前行 + 下一行 */}
          <div className={styles.lyricsOverlay}>
            {currentWordLine ? (
              <div className={styles.overlayCurrentLine}>
                <KtvLine
                  words={currentWordLine.words}
                  lineDurationMs={currentWordLine.durationMs}
                  lineStartMs={currentWordLine.time * 1000}
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
                  lineStartMs={nextWordLine.time * 1000}
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
