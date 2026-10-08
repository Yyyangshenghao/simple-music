import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLyricsStore } from '../../stores/lyrics'
import { springGentle } from '../../lib/motion-presets'
import { usePlayerStore } from '../../stores/player'
import { useProviderStore } from '../../stores/providers'
import { SourceName } from '../ui/SourceName'
import { useSettingsStore } from '../../stores/settings'
import { useVisualStore } from '../../stores/visual'
import { useAmbientStore } from '../../stores/ambient'
import { LyricLine } from './LyricLine'
import { KtvLine } from './KtvLine'
import { ArtistLinks } from '../ui/ArtistLinks'
import { EffectSwitcher } from './EffectSwitcher'
import styles from './LyricsPanel.module.css'
import { sizedImage } from '../../lib/image-size'

const LyricsScene = lazy(() => import('./LyricsScene'))

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

interface LayoutSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}

function LayoutSlider({ label, value, min, max, step, format, onChange }: LayoutSliderProps) {
  const progress = ((value - min) / (max - min)) * 100
  return (
    <label className={styles.layoutSliderRow}>
      <span className={styles.popLabel}>{label}</span>
      <input
        className={styles.layoutSlider}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--range-progress': `${progress}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className={styles.layoutValue}>{format(value)}</span>
    </label>
  )
}

export function LyricsPanel({ open, controlsHidden, onClose }: LyricsPanelProps) {
  const track = usePlayerStore((s) => s.currentTrack)
  const lines = useLyricsStore((s) => s.lines)
  const lyricSource = useLyricsStore((s) => s.source)
  const lyricsLoading = useLyricsStore((s) => s.loading)
  const hasMatchingSource = useProviderStore((s) => [s.byId.netease, s.byId.qq].some(source => source.enabled && source.auth === 'authenticated'))
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
  const lyricsLayout = useSettingsStore((s) => s.lyricsLayout)
  const setLyricsLayout = useSettingsStore((s) => s.setLyricsLayout)
  const resetLyricsLayout = useSettingsStore((s) => s.resetLyricsLayout)
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
  const lyrics3dStyle = useSettingsStore((s) => s.lyrics3dStyle)
  // 浅色封面判定:仅 cover-cloud 会把封面铺满背景,其他 3D 效果底色恒深,保持白字。
  // 阈值 0.65:粒子墙点间有暗色缝隙,画面实际亮度低于封面本身,不必等到接近纯白才翻转
  const coverLuma = useAmbientStore((s) => s.coverLuma)
  const lightCover = lyrics3dEffect === 'cover-cloud' && coverLuma > 0.65

  // 面板常驻挂载,关闭时仅 translateY(100%) 移出视口——若内容照常渲染,
  // 激活行 KtvLine 的 rAF 扫光、封面模糊层、数百行歌词节点会在后台空转。
  // 关闭后等收起过渡(0.42s)结束再卸载内容;打开时渲染期同步挂载,
  // 保证依赖 scrollRef 容器的定位 effect 在同一次提交后就能拿到 DOM
  const [contentMounted, setContentMounted] = useState(open)
  if (open && !contentMounted) setContentMounted(true)
  useEffect(() => {
    if (open) return
    const timer = setTimeout(() => setContentMounted(false), 460)
    return () => clearTimeout(timer)
  }, [open])

  // 3D 效果下拉菜单:已处于 3D 模式时再点一次 3D 按钮才展开
  const [effectMenuOpen, setEffectMenuOpen] = useState(false)
  const [effectMenuTab, setEffectMenuTab] = useState<'scene' | 'adjust'>('scene')

  // 右缘侧栏的歌词设置浮层(自由排版/字号/同步)
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

  const scrollToLine = (index: number, behavior: ScrollBehavior) => {
    const container = scrollRef.current
    if (!container) return
    const el = container.querySelector<HTMLElement>(`[data-line='${index}']`)
    if (!el && index >= 0) return
    const top = el ? el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2 : 0
    container.scrollTo({ top, behavior })
  }

  // 面板收起/切模式时顺带收起下拉与浮层,避免下次打开残留展开态
  useEffect(() => {
    if (!open) setEffectMenuOpen(false)
    if (!open || mode !== 'lyrics') setSettingsPopOpen(false)
  }, [open, mode])

  // 歌词就位、重新打开或切回普通模式时，按当前播放行恢复定位。
  // 先解除浏览挂起；只有尚未进入第一句时才回到开头，避免覆盖当前行定位。
  useEffect(() => {
    userScrollUntilRef.current = 0
    clearResumeTimer()
    setBrowsing(false)
    if (open && mode === 'lyrics' && contentMounted) {
      scrollToLine(useLyricsStore.getState().currentIndex, 'instant')
    }
  }, [lines, mode, open, contentMounted])

  // 平滑滚动到当前行（仅纯歌词模式;用户正在浏览歌词时挂起,不抢滚动位置）
  useEffect(() => {
    if (mode !== 'lyrics' || currentIndex < 0 || !open) return
    if (Date.now() < userScrollUntilRef.current) return
    scrollToLine(currentIndex, 'smooth')
  }, [currentIndex, open, mode])

  // 手动滚动检测:wheel/touchmove 只来自用户(程序 scrollTo 不触发),
  // 挂起自动居中,停止滚动 4s 后恢复并平滑回到当前行
  useEffect(() => {
    if (mode !== 'lyrics' || !open) return
    const container = scrollRef.current
    if (!container) return
    const onUserScroll = () => {
      userScrollUntilRef.current = Date.now() + USER_SCROLL_RESUME_MS
      setBrowsing(true)
      clearResumeTimer()
      resumeTimerRef.current = setTimeout(() => {
        userScrollUntilRef.current = 0
        setBrowsing(false)
        const idx = useLyricsStore.getState().currentIndex
        if (idx >= 0) scrollToLine(idx, 'smooth')
      }, USER_SCROLL_RESUME_MS)
    }
    container.addEventListener('wheel', onUserScroll, { passive: true })
    container.addEventListener('touchmove', onUserScroll, { passive: true })
    return () => {
      container.removeEventListener('wheel', onUserScroll)
      container.removeEventListener('touchmove', onUserScroll)
      clearResumeTimer()
    }
    // lines.length 影响滚动容器是否渲染(空歌词是 .empty 占位),变化时需重新挂监听;
    // contentMounted 变化意味着容器刚重建,同样要重挂
  }, [mode, open, lines.length, contentMounted])

  // 点击歌词行跳转:仅浏览态(滚动过)可点——没滚动过说明用户没有跳转意图。
  // 行时间是"歌词时间轴"上的值,换算回播放位置要减去用户偏移;
  // 加 10ms 保证落点在该行内而不是压在边界上。点击即表达了"回到跟唱位置",立即解除滚动挂起
  const seekToLine = (lineTime: number, index: number) => {
    if (!browsing) return
    userScrollUntilRef.current = 0
    clearResumeTimer()
    setBrowsing(false)
    usePlayerStore.getState().seek(Math.max(0, lineTime - offsetSec + 0.01))
    // 点击当前高亮行时行号可能不变，也需要主动恢复定位。
    scrollToLine(index, 'smooth')
  }

  // 当前行的逐字数据
  const currentWordLine = currentIndex >= 0 ? wordLines[currentIndex] : undefined

  // 纯 LRC 行数据
  const currentPlainLine = currentIndex >= 0 ? lines[currentIndex] : undefined
  const previousPlainLine = currentIndex > 0 ? lines[currentIndex - 1] : undefined
  const nextPlainLine = currentIndex >= 0 ? lines[currentIndex + 1] : undefined

  // 内容不透明铺满面板时(有封面的纯歌词模式/3D 场景),面板自身的全屏
  // modal 级 backdrop-filter 完全被遮挡,却仍迫使 GPU 逐帧模糊取样整个视口——去掉它
  const backdropOccluded = contentMounted && ((mode === 'lyrics' && !!track?.cover) || mode === '3d')

  return (
    <div className={`${styles.panel}${open ? ` ${styles.open}` : ''}${controlsHidden ? ` ${styles.immersive}` : ''}${backdropOccluded ? ` ${styles.noBackdrop}` : ''}`}>
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
              title={lyrics3dEnabled ? '选择 3D 场景与文字' : '已在设置的歌词与动效中关闭 3D 歌词'}
              onClick={() => {
                if (mode !== '3d') {
                  setMode('3d')
                } else {
                  setEffectMenuTab('scene')
                  setEffectMenuOpen(effectMenuTab === 'scene' ? !effectMenuOpen : true)
                }
              }}
            >
              3D
            </button>
            {effectMenuOpen && mode === '3d' && (
              <EffectSwitcher tab={effectMenuTab} onTabChange={setEffectMenuTab} onClose={() => setEffectMenuOpen(false)} />
            )}
          </div>
        </div>

      </div>

      {/* ===== 纯歌词模式 =====(关闭并收起完成后卸载,不在后台空转) */}
      {mode === 'lyrics' && contentMounted && (
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
          <div
            className={styles.splitLayout}
            style={{
              '--lyrics-cover-scale': lyricsLayout.coverScale,
              '--lyrics-cover-x': `${lyricsLayout.coverX}vw`,
              '--lyrics-cover-y': `${lyricsLayout.coverY}vh`,
              '--lyrics-column-width': `${lyricsLayout.lyricsWidth}%`,
              '--lyrics-column-x': `${lyricsLayout.lyricsX}vw`,
              '--lyrics-column-y': `${lyricsLayout.lyricsY}vh`,
              '--lyrics-font-scale': lyricsFontScale
            } as React.CSSProperties}
          >
            <div className={styles.coverSection}>
              {track?.cover ? (
                <img
                  className={styles.coverArt}
                  src={sizedImage(track.cover, 840)}
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
                {lyricSource && (lyricSource === 'apple' || lyricSource !== track?.source) && (
                  <span className={styles.lyricSource}>{lyricSource === 'apple' ? <><SourceName source="apple" /> 原生歌词</> : <>歌词来自 <SourceName source={lyricSource} /> · 同曲匹配</>}</span>
                )}
              </div>
            </div>

            {lines.length === 0 ? (
              <div className={styles.empty}>
                {lyricsLoading ? '正在加载歌词…' : track?.source === 'apple'
                  ? hasMatchingSource ? '暂无可用歌词' : '暂无 Apple Music 原生歌词，可启用网易云或 QQ 音乐补充匹配'
                  : '暂无歌词'}
              </div>
            ) : (
              <div
                className={`${styles.lyricsScroll}${browsing ? ` ${styles.browsing}` : ''}`}
                ref={scrollRef}
              >
                <div className={styles.lyricsPad} aria-hidden="true" />
                {lines.map((line, i) => {
                  const isActive = i === currentIndex
                  const wordLine = wordLines[i]

                  // 所有行统一用 KtvLine 渲染：切行时是同一节点上的 CSS 过渡，
                  // 字号一致，激活态只靠 scale/亮度区分
                  if (wordLine?.words.length) {
                    return (
                      <div
                        key={`${line.time}-${i}`}
                        data-line={i}
                        className={styles.ktvLineWrap}
                        onClick={() => seekToLine(line.time, i)}
                      >
                        <KtvLine
                          words={wordLine.words}
                          lineStartMs={wordLine.time * 1000}
                          active={isActive && open}
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
                    <div key={`${line.time}-${i}`} data-line={i} onClick={() => seekToLine(line.time, i)}>
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
                    <div className={styles.popHeader}>
                      <div>
                        <strong>舞台排版</strong>
                        <span>封面与歌词可独立移动、缩放</span>
                      </div>
                      <button className={styles.resetLayoutBtn} onClick={resetLyricsLayout}>重置</button>
                    </div>
                    <div className={styles.layoutPresets}>
                      <button onClick={() => {
                        setLyricsLayout({ coverScale: 1, coverX: 0, coverY: 0, lyricsWidth: 56, lyricsX: 0, lyricsY: 0 })
                        setLyricsFontScale(1)
                      }}>平衡</button>
                      <button onClick={() => {
                        setLyricsLayout({ coverScale: 1.22, coverX: 2, coverY: 0, lyricsWidth: 47, lyricsX: 1, lyricsY: 1 })
                        setLyricsFontScale(0.9)
                      }}>封面主导</button>
                      <button onClick={() => {
                        setLyricsLayout({ coverScale: 0.72, coverX: -3, coverY: -3, lyricsWidth: 64, lyricsX: -2, lyricsY: 0 })
                        setLyricsFontScale(1.15)
                      }}>歌词主导</button>
                    </div>
                    <div className={styles.layoutGroup}>
                      <span className={styles.layoutGroupTitle}>封面</span>
                      <LayoutSlider label="大小" value={lyricsLayout.coverScale} min={0.6} max={1.4} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(coverScale) => setLyricsLayout({ coverScale })} />
                      <LayoutSlider label="水平" value={lyricsLayout.coverX} min={-20} max={20} step={1} format={(v) => `${v > 0 ? '+' : ''}${v}`} onChange={(coverX) => setLyricsLayout({ coverX })} />
                      <LayoutSlider label="垂直" value={lyricsLayout.coverY} min={-20} max={20} step={1} format={(v) => `${v > 0 ? '+' : ''}${v}`} onChange={(coverY) => setLyricsLayout({ coverY })} />
                    </div>
                    <div className={styles.layoutGroup}>
                      <span className={styles.layoutGroupTitle}>歌词</span>
                      <LayoutSlider label="字号" value={lyricsFontScale} min={0.7} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setLyricsFontScale} />
                      <LayoutSlider label="宽度" value={lyricsLayout.lyricsWidth} min={36} max={68} step={1} format={(v) => `${v}%`} onChange={(lyricsWidth) => setLyricsLayout({ lyricsWidth })} />
                      <LayoutSlider label="水平" value={lyricsLayout.lyricsX} min={-20} max={20} step={1} format={(v) => `${v > 0 ? '+' : ''}${v}`} onChange={(lyricsX) => setLyricsLayout({ lyricsX })} />
                      <LayoutSlider label="垂直" value={lyricsLayout.lyricsY} min={-20} max={20} step={1} format={(v) => `${v > 0 ? '+' : ''}${v}`} onChange={(lyricsY) => setLyricsLayout({ lyricsY })} />
                    </div>
                    <div className={`${styles.popRow} ${styles.syncRow}`}>
                      <span className={styles.popLabel}>歌词同步</span>
                      <span className={styles.popValue}>{offsetSec > 0 ? '+' : ''}{offsetSec.toFixed(1)}s</span>
                    </div>
                    <div className={styles.popRow}>
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
          <Suspense fallback={null}>
            <LyricsScene coverUrl={track?.cover} />
          </Suspense>

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

          {/* 聚焦叠层：居中大字 + 上下文预览 */}
          {lyrics3dStyle === 'focus' && (
          <div className={`${styles.lyricsOverlay} ${lightCover ? styles.lightCover : ''}`}>
            <div className={styles.overlayLineStack}>
              <motion.div key={`previous-${currentIndex}`} className={`${styles.overlayContextLine} ${styles.overlayPreviousLine}`}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: previousPlainLine ? 0.42 : 0, y: 0 }} transition={springGentle}>
                {previousPlainLine?.text}
              </motion.div>
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
                  {currentWordLine?.words.length ? (
                    <KtvLine
                      words={currentWordLine.words}
                      lineStartMs={currentWordLine.time * 1000}
                      active={true}
                      translationText={showTranslation ? translation[currentIndex]?.text || undefined : undefined}
                    />
                  ) : currentPlainLine ? (
                    <LyricLine
                      text={currentPlainLine.text}
                      translation={showTranslation ? translation[currentIndex]?.text || undefined : undefined}
                      active={true}
                      overlay
                    />
                  ) : (
                    <div className={styles.overlayPlaceholder}>—</div>
                  )}
                </motion.div>
              </AnimatePresence>
              <motion.div key={`next-${currentIndex}`} className={`${styles.overlayContextLine} ${styles.overlayNextLine}`}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: nextPlainLine ? 0.3 : 0, y: 0 }} transition={springGentle}>
                {nextPlainLine?.text}
              </motion.div>
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  )
}
