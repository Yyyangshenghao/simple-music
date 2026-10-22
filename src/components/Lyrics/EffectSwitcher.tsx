import { useId, useState } from 'react'
import { motion } from 'motion/react'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import { useSettingsStore } from '../../stores/settings'
import type { Lyrics3dStyle } from '../../types/domain'
import styles from './EffectSwitcher.module.css'

interface StyleInfo {
  id: Lyrics3dStyle
  label: string
  hint: string
  icon: JSX.Element
}

const LYRIC_STYLES: StyleInfo[] = [
  {
    id: 'storyboard',
    label: '分镜',
    hint: '每句一个镜头，构图接力，副歌重现同一取景',
    icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6V3h3M14 3h3v3M17 14v3h-3M6 17H3v-3" /><path d="M7 8.5h4M7 11.5h6" />
      </svg>
    )
  },
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

/** 3D 舞台的文字风格与场景调节；嵌在动态样式选择器的「更多设置」里。 */
export function Stage3dSettings() {
  const [tab, onTabChange] = useState<'scene' | 'adjust'>('scene')
  const activeStyle = useSettingsStore((s) => s.lyrics3dStyle)
  const setStyle = useSettingsStore((s) => s.setLyrics3dStyle)
  const displayMode = useSettingsStore((s) => s.lyrics3d.displayMode)
  const params = useSettingsStore((s) => s.lyrics3d)
  const overlayBlur = useSettingsStore((s) => s.lyricsOverlayBlur)
  const setOverlayBlur = useSettingsStore((s) => s.setLyricsOverlayBlur)
  const setParams = useSettingsStore((s) => s.setLyrics3dParams)
  const patch = (key: keyof typeof params) => (value: number) => setParams({ [key]: value })

  return (
    <div className={styles.embedded} aria-label="3D 舞台设置">
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
            <strong>封面粒子云</strong>
            <span>调整时可直接看到舞台变化</span>
          </div>
          <TuningSlider label="粒子数量" value={params.particleCount} min={0.25} max={2} step={0.05} onChange={patch('particleCount')} />
          <TuningSlider label="粒子大小" value={params.particleSize} min={0.2} max={2} step={0.05} onChange={patch('particleSize')} />
          <TuningSlider label="场景亮度" value={params.particleBrightness} min={0.3} max={2} step={0.05} onChange={patch('particleBrightness')} />
          <TuningSlider label="动效强度" value={params.motionIntensity} min={0.2} max={2} step={0.05} onChange={patch('motionIntensity')} />
          {activeStyle === 'focus' && <TuningSlider label="辉光强度" value={params.glowStrength} min={0} max={2} step={0.05} onChange={patch('glowStrength')} />}
          <div className={styles.tuningDivider}>鼓点波纹 · 封面粒子云</div>
          <TuningSlider label="波纹数量" value={params.rippleCount} min={1} max={6} step={1}
            format={(v) => `${v} 道`} onChange={patch('rippleCount')} />
          <TuningSlider label="触发灵敏度" value={params.rippleSensitivity} min={0} max={1} step={0.01} onChange={patch('rippleSensitivity')} />
          <TuningSlider label="扩散时长" value={params.rippleDuration} min={0.2} max={1.5} step={0.05}
            format={(v) => `${v.toFixed(2)}s`} onChange={patch('rippleDuration')} />
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
    </div>
  )
}
