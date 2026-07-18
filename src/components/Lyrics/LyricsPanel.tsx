import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AnimatePresence, motion } from 'motion/react'
import { useLyricsStore } from '../../stores/lyrics'
import { useWindowActive } from '../../hooks/useWindowActive'
import { springGentle } from '../../lib/motion-presets'
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
import { FrameLimiter } from '../Visualizer/FrameLimiter'
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
  const storedMode = useSettingsStore((s) => s.lyricsPanelMode)  // added by Agent A
  const setMode = useSettingsStore((s) => s.setLyricsPanelMode)  // added by Agent A
  const lyrics3dEnabled = useSettingsStore((s) => s.performance.lyrics3dEnabled)
  // 设置里关掉 3D 歌词时强制回落纯文字模式,不覆盖用户存的偏好(重新开启后原选择还在)
  const mode = lyrics3dEnabled ? storedMode : 'lyrics'
  const backgroundColor = useVisualStore((s) => s.fx.backgroundColor)
  const lyrics3dEffect = useSettingsStore((s) => s.lyrics3dEffect)
  const overlayBlur = useSettingsStore((s) => s.lyricsOverlayBlur)
  const fpsCap = useSettingsStore((s) => s.lyrics3d.fpsCap)
  const renderScale = useSettingsStore((s) => s.lyrics3d.renderScale)
  // 窗口失活(最小化/切走/失焦)时完全停掉 3D 渲染循环,与背景流体的暂停策略一致
  const windowActive = useWindowActive()
  const EffectComponent = EFFECT_COMPONENTS[lyrics3dEffect]

  // 3D 效果下拉菜单:已处于 3D 模式时再点一次 3D 按钮才展开
  const [effectMenuOpen, setEffectMenuOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  // 面板收起时顺带收起效果下拉,避免下次打开残留展开态
  useEffect(() => {
    if (!open) setEffectMenuOpen(false)
  }, [open])

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

  // 纯 LRC 行数据
  const currentPlainLine = currentIndex >= 0 ? lines[currentIndex] : undefined

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
            onClick={() => {
              setMode('lyrics')
              setEffectMenuOpen(false)
            }}
          >
            歌词
          </button>
          <div className={styles.modeBtnAnchor}>
            <button
              className={`${styles.modeBtn}${mode === '3d' ? ` ${styles.modeBtnActive}` : ''}`}
              disabled={!lyrics3dEnabled}
              title={lyrics3dEnabled ? undefined : '已在设置的性能选项中关闭 3D 歌词'}
              onClick={() => {
                if (mode !== '3d') {
                  setMode('3d')
                } else {
                  setEffectMenuOpen((v) => !v)
                }
              }}
            >
              3D
            </button>
            {effectMenuOpen && mode === '3d' && (
              <EffectSwitcher onClose={() => setEffectMenuOpen(false)} />
            )}
          </div>
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
        <div
          className={`${styles.scene3d} ${styles.scene3dGlow}`}
          style={{ '--scene-base': backgroundColor || '#05060c' } as React.CSSProperties}
        >
          <Canvas
            camera={{ position: [0, 0, 14], fov: 60 }}
            dpr={renderScale}
            frameloop={!windowActive ? 'never' : fpsCap > 0 ? 'demand' : 'always'}
            gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
          >
            <FrameLimiter fps={windowActive ? fpsCap : 0} />
            <CinemaCamera />
            <EffectComponent coverUrl={track?.cover} />
          </Canvas>

          <div className={styles.sceneTopFade} aria-hidden="true" />
          <div className={styles.sceneVignette} aria-hidden="true" />

          <motion.div
            key={lyrics3dEffect}
            className={`${styles.effectFade} ${styles.scene3dGlow}`}
            style={{ '--scene-base': backgroundColor || '#05060c' } as React.CSSProperties}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            aria-hidden="true"
          />

          {/* 歌词叠加层：居中大字 + 玻璃卡片；卡片模糊/背景强度可在设置里调节，最低即完全透明 */}
          <div className={styles.lyricsOverlay}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={currentIndex}
                className={styles.overlayCurrentLine}
                style={{
                  '--overlay-blur': `${overlayBlur * 26}px`,
                  '--overlay-bg': overlayBlur * 0.46,
                  '--overlay-shadow': overlayBlur * 0.4
                } as React.CSSProperties}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={springGentle}
              >
                {currentWordLine ? (
                  <KtvLine
                    words={currentWordLine.words}
                    lineDurationMs={currentWordLine.durationMs}
                    lineStartMs={currentWordLine.time * 1000}
                    active={true}
                    translationText={translation[currentIndex]?.text || undefined}
                  />
                ) : currentPlainLine ? (
                  <LyricLine
                    text={currentPlainLine.text}
                    translation={translation[currentIndex]?.text || undefined}
                    active={true}
                    overlay
                  />
                ) : (
                  <div className={styles.overlayPlaceholder}>—</div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  )
}
