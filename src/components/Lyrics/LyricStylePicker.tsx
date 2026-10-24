import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { springSnappy } from '../../lib/motion-presets'
import { DEFAULT_LYRIC_STYLE, isLyricStyleId, LYRIC_STYLES, lyricStyleInfo, type TuningField, type TuningValue } from '../../lib/lyric-style-catalog'
import { useLyricStylesStore, useLyricStyleTuning } from '../../stores/lyric-styles'
import { useSettingsStore } from '../../stores/settings'
import { Switch } from '../ui/Switch'
import { LyricOptionGroup } from './LyricOptionGroup'
import { LYRIC_STYLE_VIEWS } from './styles/registry'
import styles from './LyricStylePicker.module.css'

function formatValue(field: Extract<TuningField, { type: 'number' }>, value: number): string {
  if (field.format === 'percent') return `${Math.round(value * 100)}%`
  return `${value.toFixed(2)}×`
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
  return (
    <label className={styles.row} htmlFor={id}>
      <span>{field.label}</span>
      <input id={id} type="range" min={field.min} max={field.max} step={field.step} value={number}
        style={{ '--range-progress': `${((number - field.min) / (field.max - field.min)) * 100}%` } as React.CSSProperties}
        aria-valuetext={formatValue(field, number)} onChange={event => onChange(Number(event.currentTarget.value))} />
      <output htmlFor={id}>{formatValue(field, number)}</output>
    </label>
  )
}

/** 预览按真实舞台尺寸排版后整体缩小到卡片，卡片里看到的就是主舞台的缩略版。 */
const PREVIEW_WIDTH = 1280

function PreviewFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [scale, setScale] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setScale(element.clientWidth / PREVIEW_WIDTH)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <span ref={ref} className={styles.previewHost}>
      <span className={styles.previewCanvas} style={{ transform: `scale(${scale})` }}>{scale > 0 && children}</span>
    </span>
  )
}

interface LyricStylePickerProps {
  onClose(): void
}

/** 「动态」歌词的样式选择器：样式卡片（实时预览）、常用参数与更多设置。 */
export function LyricStylePicker({ onClose }: LyricStylePickerProps) {
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
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const fontId = useId()

  const info = lyricStyleInfo(current)
  const view = LYRIC_STYLE_VIEWS[current]
  const quick = info.tuning.filter(field => info.quick.includes(field.key))
  const Settings = view.Settings
  const hasMore = !!Settings || info.tuning.length > quick.length
  const focusedSettings = expanded && !!Settings

  return (
    <>
      <div className={`${styles.backdrop} no-drag`} onClick={onClose} />
      <motion.div className={`${styles.menu} no-drag`} role="dialog" aria-label="动态歌词样式"
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={springSnappy}>
        {focusedSettings ? <div className={styles.settingsHeader}>
          <strong>{info.label}</strong>
          <button type="button" onClick={() => setExpanded(false)}>返回样式</button>
        </div> : <div className={styles.cards} role="radiogroup" aria-label="样式">
          {[...LYRIC_STYLES].sort((a, b) => a.order - b.order).map(style => {
            const entry = LYRIC_STYLE_VIEWS[style.id]
            const selected = current === style.id
            const Preview = style.preview === 'live' ? entry.Preview : undefined
            return (
              <button key={style.id} type="button" role="radio" aria-checked={selected}
                className={`${styles.card}${selected ? ` ${styles.cardActive}` : ''}`}
                title={style.hint}
                onClick={() => {
                  setStyle(style.id)
                  setExpanded(false)
                }}>
                <span className={styles.thumb} aria-hidden="true">
                  {Preview ? <PreviewFrame><Preview /></PreviewFrame> : entry.glyph}
                </span>
                <span className={styles.cardLabel}>{style.label}</span>
              </button>
            )
          })}
        </div>}

        {!focusedSettings && <div className={styles.section}>
          <label className={styles.row} htmlFor={fontId}>
            <span>字号</span>
            <input id={fontId} type="range" min={0.7} max={1.5} step={0.05} value={fontScale}
              style={{ '--range-progress': `${((fontScale - 0.7) / 0.8) * 100}%` } as React.CSSProperties}
              aria-valuetext={`${Math.round(fontScale * 100)}%`} onChange={event => setFontScale(Number(event.currentTarget.value))} />
            <output htmlFor={fontId}>{Math.round(fontScale * 100)}%</output>
          </label>
          <div className={styles.row}>
            <span>显示翻译</span>
            <Switch checked={showTranslation} onChange={setShowTranslation} aria-label="显示翻译" />
          </div>
          {quick.map(field => (
            <TuningControl key={field.key} field={field} value={tuning[field.key]} onChange={value => setTuning(current, { [field.key]: value })} />
          ))}
          {!hasMore && modified && (
            <button type="button" className={styles.reset} onClick={() => resetTuning(current)}>恢复「{info.label}」默认</button>
          )}
        </div>}

        {hasMore && (
          <div className={styles.more}>
            {!focusedSettings && <button type="button" className={styles.moreToggle} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? '收起设置' : `更多「${info.label}」设置`}
            </button>}
            {expanded && (Settings ? <Settings /> : (
              <div className={styles.section}>
                {info.tuning.filter(field => !info.quick.includes(field.key)).map(field => (
                  <TuningControl key={field.key} field={field} value={tuning[field.key]} onChange={value => setTuning(current, { [field.key]: value })} />
                ))}
                <button type="button" className={styles.reset} onClick={() => resetTuning(current)}>恢复默认</button>
              </div>
            ))}
          </div>
        )}

      </motion.div>
    </>
  )
}
