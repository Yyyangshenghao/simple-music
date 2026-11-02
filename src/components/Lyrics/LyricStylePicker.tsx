import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { springGentle, springSnappy } from '../../lib/motion-presets'
import { DEFAULT_LYRIC_STYLE, isLyricStyleId, LYRIC_STYLES, lyricStyleInfo, type LyricStyleId, type TuningField, type TuningValue } from '../../lib/lyric-style-catalog'
import { useLyricStylesStore, useLyricStyleTuning } from '../../stores/lyric-styles'
import { useSettingsStore } from '../../stores/settings'
import { Switch } from '../ui/Switch'
import { ScrollThumb } from '../ui/ScrollThumb'
import { LyricOptionGroup } from './LyricOptionGroup'
import { LYRIC_STYLE_VIEWS } from './styles/registry'
import styles from './LyricStylePicker.module.css'
import { useMotion, usePageTransition } from '../../hooks/useMotion'

function formatValue(field: Extract<TuningField, { type: 'number' }>, value: number): string {
  if (field.format === 'percent') return `${Math.round(value * 100)}%`
  return `${value.toFixed(2)}×`
}

function Slider({ id, label, min, max, step, value, text, onChange }: {
  id: string; label: string; min: number; max: number; step: number; value: number; text: string; onChange(value: number): void
}) {
  return (
    <label className={styles.row} htmlFor={id}>
      <span>{label}</span>
      <input id={id} className={styles.slider} type="range" min={min} max={max} step={step} value={value}
        style={{ '--range-progress': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        aria-valuetext={text} onChange={event => onChange(Number(event.currentTarget.value))} />
      <output htmlFor={id}>{text}</output>
    </label>
  )
}

function TuningControl({ field, value, onChange }: { field: TuningField; value: TuningValue; onChange(value: TuningValue): void }) {
  const id = useId()
  if (field.type === 'boolean') {
    return (
      <div className={styles.row}>
        <span>{field.label}</span>
        <Switch checked={value === true} onChange={onChange} aria-label={field.label} />
      </div>
    )
  }
  if (field.type === 'select') {
    return <LyricOptionGroup label={field.label} options={field.options} value={String(value)} onChange={onChange} />
  }
  if (field.presets) return <LyricOptionGroup label={field.label} options={field.presets}
    value={field.presets.some(preset => preset.value === value) ? Number(value) : undefined} onChange={onChange} />
  const number = Number(value)
  return <Slider id={id} label={field.label} min={field.min} max={field.max} step={field.step} value={number}
    text={formatValue(field, number)} onChange={onChange} />
}

/** 预览按真实舞台尺寸排版后整体缩小到预览框，看到的就是主舞台的缩略版；框比 16:10 扁时按铺满居中裁切。 */
const PREVIEW_WIDTH = 1280
const PREVIEW_HEIGHT = 800

function PreviewFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [frame, setFrame] = useState({ scale: 0, x: 0, y: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      const scale = Math.max(width / PREVIEW_WIDTH, height / PREVIEW_HEIGHT)
      setFrame({ scale, x: (width - PREVIEW_WIDTH * scale) / 2, y: (height - PREVIEW_HEIGHT * scale) / 2 })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <span ref={ref} className={styles.previewHost}>
      <span className={styles.previewCanvas} style={{ transform: `translate(${frame.x}px, ${frame.y}px) scale(${frame.scale})` }}>{frame.scale > 0 && children}</span>
    </span>
  )
}

/** 高度跟随内容平滑伸缩：切换样式、展开更多设置时面板不跳。 */
function AutoHeight({ children }: { children: ReactNode }) {
  const pageTransition = usePageTransition()
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const element = inner.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <motion.div className={styles.autoHeight} initial={false} animate={{ height }} transition={pageTransition(springGentle)}>
      <div ref={inner}>{children}</div>
    </motion.div>
  )
}

/** 大预览：当前样式（或悬停中的样式）的实时缩略舞台，切换时新旧两层交叉淡化。 */
function StyleHero({ id }: { id: LyricStyleId }) {
  const pageTransition = usePageTransition()
  const info = lyricStyleInfo(id)
  const entry = LYRIC_STYLE_VIEWS[id]
  const Preview = info.preview === 'live' ? entry.Preview : undefined
  const fade = pageTransition({ duration: 0.42, ease: [0.22, 1, 0.36, 1] as const })
  return (
    <div className={styles.hero} aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.span key={id} className={styles.heroLayer}
          initial={{ opacity: 0, scale: 1.045, filter: 'blur(8px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.985, filter: 'blur(6px)' }}
          transition={fade}>
          {Preview ? <PreviewFrame><Preview /></PreviewFrame> : <span className={styles.heroGlyph}>{entry.glyph}</span>}
        </motion.span>
      </AnimatePresence>
      <span className={styles.heroShade} />
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={id} className={styles.heroCaption}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={fade}>
          <strong>{info.label}</strong>
          <small>{info.hint}</small>
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

const PEEK_DELAY = 140
const PEEK_RELEASE = 160

/** 样式横条：名字胶囊一行排开，超出时横向滚动；滚轮、拖动、触控板都能横移，两端渐隐提示还有内容。 */
function StyleRail({ current, onPick, onPeek }: { current: LyricStyleId; onPick(id: LyricStyleId): void; onPeek(id: LyricStyleId | null): void }) {
  const indicatorMotion = useMotion('indicatorMotion')
  const rail = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const peekTimer = useRef<number | undefined>(undefined)
  const [edges, setEdges] = useState({ start: false, end: false })
  const ordered = [...LYRIC_STYLES].sort((a, b) => a.order - b.order)

  const syncEdges = () => {
    const element = rail.current
    if (!element) return
    const start = element.scrollLeft > 2
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 2
    setEdges(previous => previous.start === start && previous.end === end ? previous : { start, end })
  }

  useLayoutEffect(() => {
    const element = rail.current
    if (!element) return
    syncEdges()
    const observer = new ResizeObserver(syncEdges)
    observer.observe(element)
    // 纵向滚轮转成横移；内容放得下或已到尽头时把滚轮还给面板。
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const max = element.scrollWidth - element.clientWidth
      if (max <= 0) return
      const next = Math.min(max, Math.max(0, element.scrollLeft + event.deltaY))
      if (next === element.scrollLeft) return
      event.preventDefault()
      element.scrollLeft = next
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { observer.disconnect(); element.removeEventListener('wheel', onWheel) }
  }, [])

  // 打开和切换后把选中项横向滚到可见处；只动横条自己，不用 scrollIntoView 牵动外层。
  useEffect(() => {
    const element = rail.current
    const chip = element?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!element || !chip) return
    const edge = 28
    const left = chip.offsetLeft - edge
    const right = chip.offsetLeft + chip.offsetWidth + edge - element.clientWidth
    if (element.scrollLeft > left) element.scrollTo({ left, behavior: 'smooth' })
    else if (element.scrollLeft < right) element.scrollTo({ left: right, behavior: 'smooth' })
  }, [current])

  useEffect(() => () => window.clearTimeout(peekTimer.current), [])

  // 试看只认鼠标真正停在某个未选中的胶囊上：滚动把胶囊滑到指针下、或指针已离开时都不触发。
  const endDrag = (element: HTMLElement) => {
    drag.current = null
    delete element.dataset.dragging
  }

  // 按下后还没拖过阈值就移出横条时，在文档上兜住松开，避免拖动状态残留。
  useEffect(() => {
    const release = () => { if (drag.current && !drag.current.moved && rail.current) endDrag(rail.current) }
    window.addEventListener('pointerup', release, true)
    window.addEventListener('blur', release)
    return () => { window.removeEventListener('pointerup', release, true); window.removeEventListener('blur', release) }
  }, [])

  const peek = (id: LyricStyleId | null, delay: number) => {
    window.clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => {
      if (id && !rail.current?.querySelector(`[data-style="${id}"]`)?.matches(':hover')) id = null
      onPeek(id)
    }, delay)
  }

  return (
    <div className={styles.railWrap} data-start={edges.start} data-end={edges.end}>
      <div ref={rail} className={styles.rail} role="radiogroup" aria-label="样式"
        onScroll={syncEdges}
        onPointerDown={event => {
          if (event.button !== 0 || event.pointerType === 'touch') return
          drag.current = { x: event.clientX, left: event.currentTarget.scrollLeft, moved: false }
        }}
        onPointerMove={event => {
          const state = drag.current
          if (!state) return
          // 在横条外或窗口外松开时收不到 pointerup：回来时键已抬起就当拖动结束。
          if ((event.buttons & 1) === 0) { endDrag(event.currentTarget); return }
          const dx = event.clientX - state.x
          if (!state.moved && Math.abs(dx) < 5) return
          if (!state.moved) {
            state.moved = true
            event.currentTarget.setPointerCapture(event.pointerId)
            event.currentTarget.dataset.dragging = 'true'
            peek(null, 0)
          }
          event.currentTarget.scrollLeft = state.left - dx
        }}
        onPointerUp={event => {
          if (drag.current?.moved) suppressClick.current = true
          endDrag(event.currentTarget)
        }}
        onPointerCancel={event => endDrag(event.currentTarget)}
        onLostPointerCapture={event => endDrag(event.currentTarget)}
        onClickCapture={event => {
          if (!suppressClick.current) return
          suppressClick.current = false
          event.stopPropagation()
          event.preventDefault()
        }}>
        {ordered.map(style => {
          const selected = current === style.id
          return (
            <button key={style.id} type="button" role="radio" aria-checked={selected} data-style={style.id}
              className={styles.chip} title={style.hint}
              onPointerEnter={() => { if (!drag.current?.moved) peek(selected ? null : style.id, PEEK_DELAY) }}
              onPointerLeave={() => peek(null, PEEK_RELEASE)}
              onClick={() => { window.clearTimeout(peekTimer.current); onPeek(null); onPick(style.id) }}>
              {selected && (
                <motion.span layoutId="lyric-style-chip" className={styles.chipPill}
                  transition={indicatorMotion ? { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 } : { duration: 0 }} />
              )}
              <span className={styles.chipLabel}>{style.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 2×2 方格图标：悬停时四块轻轻散开，提示「展开全部」。 */
function GridIcon() {
  return (
    <svg className={styles.gridIcon} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1.2" />
    </svg>
  )
}

/** 全部样式：每个样式一张带实时预览的卡片，看着画面挑；选中后收回到设置视图。 */
function StyleGallery({ current, onPick, onCollapse }: { current: LyricStyleId; onPick(id: LyricStyleId): void; onCollapse(): void }) {
  const pageTransition = usePageTransition()
  const ordered = [...LYRIC_STYLES].sort((a, b) => a.order - b.order)
  return (
    <>
      <div className={styles.galleryHead}>
        <span>全部样式<small>{ordered.length}</small></span>
        <button type="button" className={styles.iconButton} aria-label="收起全部样式" title="收起" onClick={onCollapse}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
        </button>
      </div>
      <div className={styles.gallery} role="radiogroup" aria-label="全部样式">
        {ordered.map((style, index) => {
          const entry = LYRIC_STYLE_VIEWS[style.id]
          const selected = current === style.id
          const Preview = style.preview === 'live' ? entry.Preview : undefined
          return (
            <motion.button key={style.id} type="button" role="radio" aria-checked={selected} className={styles.card} title={style.hint}
              initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={pageTransition({ duration: 0.34, delay: 0.04 + index * 0.035, ease: [0.22, 1, 0.36, 1] as const })}
              onClick={() => onPick(style.id)}>
              <span className={styles.thumb} aria-hidden="true">
                <span className={styles.thumbInner}>
                  {Preview ? <PreviewFrame><Preview /></PreviewFrame> : entry.glyph}
                </span>
              </span>
              <span className={styles.cardLabel}>{style.label}</span>
            </motion.button>
          )
        })}
      </div>
    </>
  )
}

const MENU_WIDTH = 316
const GALLERY_WIDTH = 480

interface LyricStylePickerProps {
  onClose(): void
}

/** 「动态」歌词的样式选择器：大预览、样式横条、通用参数与当前样式的设置。 */
export function LyricStylePicker({ onClose }: LyricStylePickerProps) {
  const pageTransition = usePageTransition()
  const sprout = useMotion('popoverSproutMotion')
  const stored = useLyricStylesStore(state => state.style)
  const setStyle = useLyricStylesStore(state => state.setStyle)
  const setTuning = useLyricStylesStore(state => state.setTuning)
  const resetTuning = useLyricStylesStore(state => state.resetTuning)
  // 与舞台一致：内存里是已撤下/未知的 ID 时实际显示默认样式，选中态与参数都跟随实际样式，不改写保存的选择。
  const current = !isLyricStyleId(stored) ? DEFAULT_LYRIC_STYLE : stored
  const tuning = useLyricStyleTuning(current)
  const modified = useLyricStylesStore(state => !!state.tunings[current])
  const fontScale = useSettingsStore(state => state.lyricsFontScale)
  const setFontScale = useSettingsStore(state => state.setLyricsFontScale)
  const showTranslation = useSettingsStore(state => state.lyricsShowTranslation)
  const setShowTranslation = useSettingsStore(state => state.setLyricsShowTranslation)
  const [expanded, setExpanded] = useState(false)
  const [peek, setPeek] = useState<LyricStyleId | null>(null)
  const [gallery, setGallery] = useState(false)
  useLayoutEffect(() => {
    // Esc 先收起全部样式，再关面板；捕获阶段监听，全局快捷键层会拦下冒泡的按键。
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (gallery) setGallery(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, gallery])
  const fontId = useId()
  const moreId = useId()
  const disclosureRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // 展开更多设置后把它滚到面板顶部附近：窗口矮时新内容常落在可视区外。
  useEffect(() => {
    if (!expanded) return
    const timer = window.setTimeout(() => {
      const button = disclosureRef.current
      const body = bodyRef.current
      if (!button || !body) return
      const top = button.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 6
      if (top > body.scrollTop) body.scrollTo({ top, behavior: 'smooth' })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [expanded])

  const info = lyricStyleInfo(current)
  const view = LYRIC_STYLE_VIEWS[current]
  const quick = info.tuning.filter(field => info.quick.includes(field.key))
  const rest = info.tuning.filter(field => !info.quick.includes(field.key))
  const Settings = view.Settings
  const hasMore = !!Settings || rest.length > 0
  const shown = peek ?? current

  const settingsView = (
    <>
      <StyleHero id={shown} />
      <div className={styles.railRow}>
        <StyleRail current={current} onPeek={setPeek} onPick={id => { setStyle(id); setExpanded(false) }} />
        <button type="button" className={styles.iconButton} aria-label="展开全部样式" title="全部样式"
          onClick={() => { setPeek(null); setGallery(true) }}>
          <GridIcon />
        </button>
      </div>

      <section className={styles.group} aria-label="通用">
        <div className={styles.groupHead}><span>通用</span></div>
        <Slider id={fontId} label="字号" min={0.7} max={1.5} step={0.05} value={fontScale}
          text={`${Math.round(fontScale * 100)}%`} onChange={setFontScale} />
        <div className={styles.row}>
          <span>显示翻译</span>
          <Switch checked={showTranslation} onChange={setShowTranslation} aria-label="显示翻译" />
        </div>
      </section>

      <AutoHeight>
        <motion.section key={current} className={styles.group} aria-label={`${info.label}设置`}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={pageTransition({ duration: 0.32, ease: [0.22, 1, 0.36, 1] as const })}>
          <div className={styles.groupHead}>
            <span>{info.label}</span>
            <AnimatePresence initial={false}>
              {modified && (
                <motion.button type="button" className={styles.reset} onClick={() => resetTuning(current)}
                  initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}
                  transition={pageTransition(springSnappy)}>恢复默认</motion.button>
              )}
            </AnimatePresence>
          </div>
          {quick.map(field => (
            <TuningControl key={field.key} field={field} value={tuning[field.key]} onChange={value => setTuning(current, { [field.key]: value })} />
          ))}
          {hasMore && (
            <button ref={disclosureRef} type="button" className={styles.disclosure} aria-expanded={expanded} aria-controls={moreId}
              onClick={() => setExpanded(!expanded)}>
              <span>{expanded ? '收起' : '更多设置'}</span>
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
            </button>
          )}
          <AnimatePresence initial={false}>
            {expanded && hasMore && (
              <motion.div id={moreId} key="more" className={styles.more}
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: pageTransition({ duration: 0.16 }) }}
                transition={pageTransition({ duration: 0.3, delay: 0.06, ease: [0.22, 1, 0.36, 1] as const })}>
                {Settings ? <Settings /> : rest.map(field => (
                  <TuningControl key={field.key} field={field} value={tuning[field.key]} onChange={value => setTuning(current, { [field.key]: value })} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      </AutoHeight>
    </>
  )

  const fadeOut = { opacity: 0, transition: pageTransition({ duration: 0.12 }) }

  return (
    <>
      <motion.div className={`${styles.backdrop} no-drag`} onClick={onClose} exit={{ pointerEvents: 'none' }} />
      <motion.div className={`${styles.menu} no-drag`} role="dialog" aria-label="动态歌词样式" data-scroll-thumb-scope=""
        initial={sprout ? { opacity: 0, y: -8, scale: 0.96 } : false}
        animate={{ opacity: 1, y: 0, scale: 1, width: gallery ? GALLERY_WIDTH : MENU_WIDTH }}
        // 收回：朝右上角的箭头缩回去。
        exit={{ opacity: 0, y: -8, scale: 0.94, transition: pageTransition({ duration: 0.2, ease: [0.4, 0, 1, 1] as const }) }}
        transition={pageTransition({ ...springSnappy, width: { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 } })}>
        <div ref={bodyRef} className={styles.menuBody}>
          {/* 设置视图与全部样式互换：先淡出旧视图，面板宽高再跟着新内容伸缩。 */}
          <AutoHeight>
            <AnimatePresence mode="wait" initial={false}>
              {gallery ? (
                <motion.div key="gallery" className={styles.view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={fadeOut}
                  transition={pageTransition({ duration: 0.2 })}>
                  <StyleGallery current={current} onCollapse={() => setGallery(false)}
                    onPick={id => { setStyle(id); setExpanded(false); setGallery(false) }} />
                </motion.div>
              ) : (
                <motion.div key="settings" className={styles.view} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={fadeOut}
                  transition={pageTransition({ duration: 0.3, ease: [0.22, 1, 0.36, 1] as const })}>
                  {settingsView}
                </motion.div>
              )}
            </AnimatePresence>
          </AutoHeight>
        </div>
        <ScrollThumb target={bodyRef} />
      </motion.div>
    </>
  )
}
