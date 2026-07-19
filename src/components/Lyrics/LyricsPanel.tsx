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

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/** 歌名溢出时左右往返滚动展示完整内容,未溢出时保持静态居中 */
function MarqueeTrackName({ text }: { text: string }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)
  const [dist, setDist] = useState(0)

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const measure = () => {
      const overflow = inner.scrollWidth - outer.clientWidth
      setDist(overflow > 1 ? overflow : 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [text])

  const scrolling = dist > 0
  return (
    <div
      ref={outerRef}
      className={`${styles.trackName} ${scrolling ? styles.trackNameScrolling : ''}`}
      title={text}
    >
      <span
        ref={innerRef}
        className={styles.trackNameInner}
        style={
          scrolling
            ? ({
                '--marquee-dist': `${dist}px`,
                '--marquee-duration': `${Math.max(6, Math.round(dist / 24) + 3)}s`
              } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </div>
  )
}

/** 用户手动滚动歌词后,这么久没再滚动才恢复自动居中 */
const USER_SCROLL_RESUME_MS = 4000

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
  const romaji = useLyricsStore((s) => s.romaji)
  const offsetSec = useLyricsStore((s) => s.offsetSec)
  const setOffsetSec = useLyricsStore((s) => s.setOffsetSec)
  const currentIndex = useLyricsStore((s) => s.currentIndex)
  const wordLines = useLyricsStore((s) => s.wordLines)           // added by Agent A
  const storedMode = useSettingsStore((s) => s.lyricsPanelMode)  // added by Agent A
  const setMode = useSettingsStore((s) => s.setLyricsPanelMode)  // added by Agent A
  const lyricsFontScale = useSettingsStore((s) => s.lyricsFontScale)
  const setLyricsFontScale = useSettingsStore((s) => s.setLyricsFontScale)
  const showTranslation = useSettingsStore((s) => s.lyricsShowTranslation)
  const setShowTranslation = useSettingsStore((s) => s.setLyricsShowTranslation)
  const showRoma = useSettingsStore((s) => s.lyricsShowRoma)
  const setShowRoma = useSettingsStore((s) => s.setLyricsShowRoma)
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

  // 右缘侧栏的歌词设置浮层(字号/快慢)
  const [settingsPopOpen, setSettingsPopOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  // 用户手动滚动的挂起窗口:在此时间戳之前不做自动居中
  const userScrollUntilRef = useRef(0)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 浏览态:用户滚动后为 true,此时歌词行才显示悬停高亮、才可点击跳转
  const [browsing, setBrowsing] = useState(false)

  const clearResumeTimer = () => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = null
    }
  }

  // 面板收起/切模式时顺带收起下拉与浮层,避免下次打开残留展开态
  useEffect(() => {
    if (!open) setEffectMenuOpen(false)
    if (!open || mode !== 'lyrics') setSettingsPopOpen(false)
  }, [open, mode])

  // 平滑滚动到当前行（仅纯歌词模式;用户正在浏览歌词时挂起,不抢滚动位置）
  useEffect(() => {
    if (mode !== 'lyrics') return
    const container = scrollRef.current
    if (!container || currentIndex < 0 || !open) return
    if (Date.now() < userScrollUntilRef.current) return
    const el = container.querySelector<HTMLElement>(`[data-line='${currentIndex}']`)
    if (!el) return
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top, behavior: 'smooth' })
  }, [currentIndex, open, mode])

  // 手动滚动检测:wheel/touchmove 只来自用户(程序 scrollTo 不触发),
  // 挂起自动居中,停止滚动 4s 后恢复并平滑回到当前行
  useEffect(() => {
    if (mode !== 'lyrics') return
    const container = scrollRef.current
    if (!container) return
    const onUserScroll = () => {
      userScrollUntilRef.current = Date.now() + USER_SCROLL_RESUME_MS
      setBrowsing(true)
      clearResumeTimer()
      resumeTimerRef.current = setTimeout(() => {
        userScrollUntilRef.current = 0
        setBrowsing(false)
        const c = scrollRef.current
        const idx = useLyricsStore.getState().currentIndex
        if (!c || idx < 0) return
        const el = c.querySelector<HTMLElement>(`[data-line='${idx}']`)
        if (!el) return
        c.scrollTo({ top: el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
      }, USER_SCROLL_RESUME_MS)
    }
    container.addEventListener('wheel', onUserScroll, { passive: true })
    container.addEventListener('touchmove', onUserScroll, { passive: true })
    return () => {
      container.removeEventListener('wheel', onUserScroll)
      container.removeEventListener('touchmove', onUserScroll)
      clearResumeTimer()
    }
    // lines.length 影响滚动容器是否渲染(空歌词是 .empty 占位),变化时需重新挂监听
  }, [mode, lines.length])

  // 切歌后新歌词就位时立即回到开头,不等第一句激活才跳(那之前 currentIndex 是 -1,上面的 effect 不动)
  useEffect(() => {
    if (mode !== 'lyrics') return
    userScrollUntilRef.current = 0
    clearResumeTimer()
    setBrowsing(false)
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [lines, mode])

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

  // 点击歌词行跳转:仅浏览态(滚动过)可点——没滚动过说明用户没有跳转意图。
  // 行时间是"歌词时间轴"上的值,换算回播放位置要减去用户偏移;
  // 加 10ms 保证落点在该行内而不是压在边界上。点击即表达了"回到跟唱位置",立即解除滚动挂起
  const seekToLine = (lineTime: number) => {
    if (!browsing) return
    userScrollUntilRef.current = 0
    clearResumeTimer()
    setBrowsing(false)
    usePlayerStore.getState().seek(Math.max(0, lineTime - offsetSec + 0.01))
  }

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
                <MarqueeTrackName text={track?.name ?? '未在播放'} />
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
              <div
                className={`${styles.lyricsScroll}${browsing ? ` ${styles.browsing}` : ''}`}
                ref={scrollRef}
                style={{ '--lyrics-font-scale': lyricsFontScale } as React.CSSProperties}
              >
                <div className={styles.lyricsPad} aria-hidden="true" />
                {lines.map((line, i) => {
                  const isActive = i === currentIndex
                  const wordLine = wordLines[i]

                  // 所有行统一用 KtvLine 渲染：切行时是同一节点上的 CSS 过渡，
                  // 字号一致，激活态只靠 scale/亮度区分
                  if (wordLine) {
                    return (
                      <div
                        key={`${line.time}-${i}`}
                        data-line={i}
                        className={styles.ktvLineWrap}
                        onClick={() => seekToLine(line.time)}
                      >
                        <KtvLine
                          words={wordLine.words}
                          lineDurationMs={wordLine.durationMs}
                          lineStartMs={wordLine.time * 1000}
                          active={isActive}
                          dim={!isActive}
                          past={i < currentIndex}
                          translationText={showTranslation ? translation[i]?.text || undefined : undefined}
                          romaText={showRoma ? romaji[i]?.text || undefined : undefined}
                          alignLeft
                        />
                      </div>
                    )
                  }

                  return (
                    <div key={`${line.time}-${i}`} data-line={i} onClick={() => seekToLine(line.time)}>
                      <LyricLine
                        text={line.text}
                        translation={showTranslation ? translation[i]?.text || undefined : undefined}
                        roma={showRoma ? romaji[i]?.text || undefined : undefined}
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

          {/* 右缘悬停控制栏:译/罗马音开关按歌显示,字号/快慢收进齿轮浮层;平时隐藏,鼠标移入右缘显现 */}
          <div className={`${styles.sideRail} no-drag${settingsPopOpen ? ` ${styles.sideRailPinned}` : ''}`}>
            <div className={styles.sideRailInner}>
              {translation.length > 0 && (
                <button
                  className={`${styles.railBtn}${showTranslation ? ` ${styles.railBtnActive}` : ''}`}
                  onClick={() => setShowTranslation(!showTranslation)}
                  title="显示/隐藏中文翻译"
                >
                  译
                </button>
              )}
              {romaji.length > 0 && (
                <button
                  className={`${styles.railBtn}${showRoma ? ` ${styles.railBtnActive}` : ''}`}
                  onClick={() => setShowRoma(!showRoma)}
                  title="显示/隐藏罗马音"
                >
                  音
                </button>
              )}
              <div className={styles.railPopAnchor}>
                <button
                  className={`${styles.railBtn}${settingsPopOpen ? ` ${styles.railBtnActive}` : ''}`}
                  onClick={() => setSettingsPopOpen((v) => !v)}
                  title="歌词设置"
                  aria-label="歌词设置"
                >
                  <GearIcon />
                </button>
                {settingsPopOpen && (
                  <div className={styles.lyricsSettingsPop}>
                    <div className={styles.popRow}>
                      <span className={styles.popLabel}>字号</span>
                      <div className={styles.popBtns}>
                        <button
                          className={styles.textCtrlBtn}
                          disabled={lyricsFontScale <= 0.7}
                          onClick={() => setLyricsFontScale(Math.round((lyricsFontScale - 0.1) * 10) / 10)}
                          title="缩小歌词字号"
                        >
                          A-
                        </button>
                        <span className={styles.popValue}>{lyricsFontScale.toFixed(1)}×</span>
                        <button
                          className={styles.textCtrlBtn}
                          disabled={lyricsFontScale >= 1.5}
                          onClick={() => setLyricsFontScale(Math.round((lyricsFontScale + 0.1) * 10) / 10)}
                          title="放大歌词字号"
                        >
                          A+
                        </button>
                      </div>
                    </div>
                    <div className={styles.popRow}>
                      <span className={styles.popLabel}>快慢</span>
                      <div className={styles.popBtns}>
                        <button
                          className={styles.textCtrlBtn}
                          onClick={() => setOffsetSec(offsetSec - 0.5)}
                          title="歌词延后 0.5 秒"
                        >
                          -0.5
                        </button>
                        <button
                          className={styles.textCtrlBtn}
                          onClick={() => setOffsetSec(offsetSec - 0.1)}
                          title="歌词延后 0.1 秒"
                        >
                          -0.1
                        </button>
                        <button
                          className={`${styles.textCtrlBtn}${offsetSec !== 0 ? ` ${styles.textCtrlBtnActive}` : ''}`}
                          onClick={() => setOffsetSec(0)}
                          title="当前歌词偏移,点击归零"
                        >
                          {offsetSec > 0 ? '+' : ''}{offsetSec.toFixed(1)}s
                        </button>
                        <button
                          className={styles.textCtrlBtn}
                          onClick={() => setOffsetSec(offsetSec + 0.1)}
                          title="歌词提前 0.1 秒"
                        >
                          +0.1
                        </button>
                        <button
                          className={styles.textCtrlBtn}
                          onClick={() => setOffsetSec(offsetSec + 0.5)}
                          title="歌词提前 0.5 秒"
                        >
                          +0.5
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
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
