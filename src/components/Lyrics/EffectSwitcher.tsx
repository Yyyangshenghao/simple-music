import { useId } from 'react'
import { motion } from 'motion/react'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import { useSettingsStore } from '../../stores/settings'
import type { Lyrics3dEffect, Lyrics3dStyle } from '../../types/domain'
import styles from './EffectSwitcher.module.css'

interface EffectInfo {
  id: Lyrics3dEffect
  label: string
  /** inline SVG for a 20x20 viewBox icon */
  icon: JSX.Element
}

const EFFECTS: EffectInfo[] = [
  {
    id: 'cover-cloud',
    label: '封面粒子云',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="5" r="1.5" />
        <circle cx="10" cy="3" r="1.5" />
        <circle cx="15" cy="5" r="1.5" />
        <circle cx="7" cy="9" r="1.5" />
        <circle cx="13" cy="9" r="1.5" />
        <circle cx="5" cy="13" r="1.5" />
        <circle cx="10" cy="11" r="1.5" />
        <circle cx="15" cy="13" r="1.5" />
        <circle cx="10" cy="16" r="1.5" />
      </svg>
    )
  },
  {
    id: 'waveform-3d',
    label: '3D 频谱环',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="12" width="2.2" height="6" rx="0.5" />
        <rect x="5.2" y="9" width="2.2" height="9" rx="0.5" />
        <rect x="8.4" y="5" width="2.2" height="13" rx="0.5" />
        <rect x="11.6" y="7" width="2.2" height="11" rx="0.5" />
        <rect x="14.8" y="10" width="2.2" height="8" rx="0.5" />
      </svg>
    )
  },
  {
    id: 'speaker-particles',
    label: '音箱沙粒',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="8" />
        <circle cx="7" cy="8" r="1" />
        <circle cx="13" cy="7" r="0.8" />
        <circle cx="9" cy="12" r="0.7" />
        <circle cx="14" cy="11" r="0.9" />
        <circle cx="6" cy="13" r="0.6" />
        <circle cx="11" cy="9" r="0.7" />
        <circle cx="8" cy="15" r="0.5" />
      </svg>
    )
  }
]

interface StyleInfo {
  id: Lyrics3dStyle
  label: string
  hint: string
  icon: JSX.Element
}

const LYRIC_STYLES: StyleInfo[] = [
  {
    id: 'glass',
    label: '玻璃',
    hint: '半透明玻璃字，倒角亮边与柔和反射',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h12l-1.5 10h-9z" /><path d="M6.5 8h7" opacity=".55" />
      </svg>
    )
  },
  {
    id: 'smooth',
    label: '丝滑',
    hint: '清爽无光效，平整连续滚动',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5.5h11" opacity=".45" /><path d="M4 10h13" /><path d="M6 14.5h9" opacity=".55" />
      </svg>
    )
  },
  {
    id: 'float',
    label: '漂浮',
    hint: '前后错层，星河中的立体悬浮',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12c3-4 5 3 8-1s4 1 6-3" /><circle cx="6" cy="5" r="1" /><circle cx="14" cy="15" r=".8" />
      </svg>
    )
  },
  {
    id: 'quick',
    label: '快切',
    hint: '横向滑入滑出，带行内进度线',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h10M6 10h11M3 14h10" /><path d="m13 3 4 3-4 3" />
      </svg>
    )
  },
  {
    id: 'shine',
    label: '流光',
    hint: '斜向流光掠过，辉光随节拍呼吸',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2v4M10 14v4M2 10h4M14 10h4" /><path d="m5 5 2 2m6 6 2 2m0-10-2 2m-6 6-2 2" />
      </svg>
    )
  },
  {
    id: 'glitch',
    label: '故障',
    hint: '节拍触发的切片错位与色差',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5h9v3h5M5 10h10M3 15h6v-3h8" />
      </svg>
    )
  },
  {
    id: 'focus',
    label: '简洁叠层',
    hint: '关闭 3D 轨道，保留大字',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6 V3h3 M14 3h3v3 M17 14v3h-3 M6 17H3v-3" />
        <path d="M5 10 H15" />
      </svg>
    )
  }
]

interface EffectSwitcherProps {
  onClose: () => void
  tab: 'scene' | 'adjust'
  onTabChange: (tab: 'scene' | 'adjust') => void
}

function TuningSlider({ label, value, min, max, step, onChange, format = (v: number) => `${Math.round(v * 100)}%` }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format?: (value: number) => string
}) {
  const id = useId()
  return (
    <label className={styles.tuningRow} htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        aria-valuetext={format(value)} onChange={(event) => onChange(Number(event.currentTarget.value))} />
      <output htmlFor={id}>{format(value)}</output>
    </label>
  )
}

/** 歌词播放页的 3D 场景选择与当前场景调节。 */
export function EffectSwitcher({ onClose, tab, onTabChange }: EffectSwitcherProps) {
  const active = useSettingsStore((s) => s.lyrics3dEffect)
  const setEffect = useSettingsStore((s) => s.setLyrics3dEffect)
  const activeStyle = useSettingsStore((s) => s.lyrics3dStyle)
  const setStyle = useSettingsStore((s) => s.setLyrics3dStyle)
  const displayMode = useSettingsStore((s) => s.lyrics3d.displayMode)
  const params = useSettingsStore((s) => s.lyrics3d)
  const overlayBlur = useSettingsStore((s) => s.lyricsOverlayBlur)
  const setOverlayBlur = useSettingsStore((s) => s.setLyricsOverlayBlur)
  const setParams = useSettingsStore((s) => s.setLyrics3dParams)
  const patch = (key: keyof typeof params) => (value: number) => setParams({ [key]: value })

  return (
    <>
      <div className={`${styles.backdrop} no-drag`} onClick={onClose} />
      <motion.div
        className={`${styles.menu} no-drag`}
        role="dialog"
        aria-label="3D 歌词设置"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSnappy}
      >
        <div className={styles.menuTabs} role="tablist" aria-label="3D 歌词选项">
          <button type="button" role="tab" aria-selected={tab === 'scene'}
            className={tab === 'scene' ? styles.menuTabActive : ''} onClick={() => onTabChange('scene')}>场景与文字</button>
          <button type="button" role="tab" aria-selected={tab === 'adjust'}
            className={tab === 'adjust' ? styles.menuTabActive : ''} onClick={() => onTabChange('adjust')}>细节调节</button>
        </div>
        {tab === 'scene' ? <>
          {activeStyle !== 'focus' && <>
          <div className={styles.sectionLabel}>同屏歌词</div>
          <div className={styles.displayModes} role="group" aria-label="同屏歌词行数">
            {([['single', '1 行'], ['dual', '2 行'], ['triple', '3 行'], ['cinema', '5 行']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${styles.displayModeBtn}${displayMode === id ? ` ${styles.displayModeBtnActive}` : ''}`}
                aria-pressed={displayMode === id}
                onClick={() => {
                  setParams({ displayMode: id })
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.divider} aria-hidden="true" />
          </>}
          <div className={styles.sectionLabel}>场景效果</div>
          {EFFECTS.map((eff) => {
            const isActive = active === eff.id
            return (
              <motion.button
                key={eff.id}
                aria-pressed={isActive}
                className={`${styles.item}${isActive ? ` ${styles.itemActive}` : ''}`}
                onClick={() => {
                  setEffect(eff.id)
                }}
                whileTap={tapScale}
                transition={springSnappy}
              >
                <span className={styles.icon}>{eff.icon}</span>
                <span className={styles.label}>{eff.label}</span>
              </motion.button>
            )
          })}
          <div className={styles.divider} aria-hidden="true" />
          <div className={styles.sectionLabel}>歌词样式</div>
          {LYRIC_STYLES.map((style) => {
            const isActive = activeStyle === style.id
            return (
              <motion.button
                key={style.id}
                aria-pressed={isActive}
                className={`${styles.item}${isActive ? ` ${styles.itemActive}` : ''}`}
                onClick={() => {
                  setStyle(style.id)
                }}
                whileTap={tapScale}
                transition={springSnappy}
              >
                <span className={styles.icon}>{style.icon}</span>
                <span className={styles.itemCopy}>
                  <span className={styles.label}>{style.label}</span>
                  <span className={styles.hint}>{style.hint}</span>
                </span>
              </motion.button>
            )
          })}
        </> : <div className={styles.tuningPanel}>
          <div className={styles.tuningHeading}>
            <strong>{EFFECTS.find((effect) => effect.id === active)?.label}</strong>
            <span>调整时可直接看到舞台变化</span>
          </div>
          <TuningSlider label="粒子数量" value={params.particleCount} min={0.25} max={2} step={0.05} onChange={patch('particleCount')} />
          <TuningSlider label={active === 'waveform-3d' ? '歌词点缀粒子大小' : '粒子大小'} value={params.particleSize} min={0.2} max={2} step={0.05} onChange={patch('particleSize')} />
          <TuningSlider label="场景亮度" value={params.particleBrightness} min={0.3} max={2} step={0.05} onChange={patch('particleBrightness')} />
          <TuningSlider label="动效强度" value={params.motionIntensity} min={0.2} max={2} step={0.05} onChange={patch('motionIntensity')} />
          {active === 'cover-cloud' && activeStyle === 'focus' && <TuningSlider label="辉光强度" value={params.glowStrength} min={0} max={2} step={0.05} onChange={patch('glowStrength')} />}
          {active === 'cover-cloud' && <>
            <div className={styles.tuningDivider}>鼓点波纹 · 封面粒子云</div>
            <TuningSlider label="波纹数量" value={params.rippleCount} min={1} max={6} step={1}
              format={(v) => `${v} 道`} onChange={patch('rippleCount')} />
            <TuningSlider label="触发灵敏度" value={params.rippleSensitivity} min={0} max={1} step={0.01} onChange={patch('rippleSensitivity')} />
            <TuningSlider label="扩散时长" value={params.rippleDuration} min={0.2} max={1.5} step={0.05}
              format={(v) => `${v.toFixed(2)}s`} onChange={patch('rippleDuration')} />
          </>}
          <div className={styles.tuningDivider}>{activeStyle === 'focus' ? '简洁叠层' : '3D 歌词 · 文字层次'}</div>
          {activeStyle === 'focus' ? <TuningSlider label="歌词底部模糊" value={overlayBlur} min={0} max={1} step={0.01} onChange={setOverlayBlur} /> : <>
            <TuningSlider label="前后歌词亮度" value={params.contextOpacity} min={0.25} max={1} step={0.01} onChange={patch('contextOpacity')} />
            <TuningSlider label="歌词行间距" value={params.contextSpread} min={0.6} max={2.4} step={0.02}
              format={(v) => `${v.toFixed(2)}×`} onChange={patch('contextSpread')} />
            <TuningSlider label="远处歌词渐隐" value={params.edgeFade} min={0} max={1} step={0.01} onChange={patch('edgeFade')} />
            <TuningSlider label="切换柔和度" value={params.motionSoftness} min={0.15} max={1.2} step={0.01}
              format={(v) => `${v.toFixed(2)}×`} onChange={patch('motionSoftness')} />
            <TuningSlider label="辉光强度" value={params.glowStrength} min={0} max={2} step={0.05} onChange={patch('glowStrength')} />
          </>}
        </div>}
      </motion.div>
    </>
  )
}
