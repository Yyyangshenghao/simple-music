import { useEffect, useId, useState } from 'react'
import { useSettingsStore } from '../../stores/settings'
import type { Lyrics3dParams, Lyrics3dStyle } from '../../types/domain'
import type { SystemFontFamily } from '../../types/ipc'
import { SystemFontPicker } from '../ui/SystemFontPicker'
import { LyricOptionGroup } from './LyricOptionGroup'
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
  }
]


function TuningSlider({ label, value, min, max, step, onChange, format = (v: number) => `${Math.round(v * 100)}%` }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange(value: number): void
  format?: (value: number) => string
}) {
  const id = useId()
  return (
    <label className={styles.tuningRow} htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        aria-valuetext={format(value)} onChange={event => onChange(Number(event.currentTarget.value))} />
      <output htmlFor={id}>{format(value)}</output>
    </label>
  )
}

/** 粒光歌词页内的完整设置，按文字、氛围和画质分组。 */
export function Stage3dSettings() {
  const panelId = useId()
  const [tab, setTab] = useState<'text' | 'scene' | 'quality'>('text')
  const activeStyle = useSettingsStore(s => s.lyrics3dStyle)
  const setStyle = useSettingsStore(s => s.setLyrics3dStyle)
  const params = useSettingsStore(s => s.lyrics3d)
  const setParams = useSettingsStore(s => s.setLyrics3dParams)
  const resetParams = useSettingsStore(s => s.resetLyrics3dParams)
  const westernFont = useSettingsStore(s => s.lyrics3dFontFamily)
  const cjkFont = useSettingsStore(s => s.lyrics3dFontFamilyCjk)
  const setWesternFont = useSettingsStore(s => s.setLyrics3dFontFamily)
  const setCjkFont = useSettingsStore(s => s.setLyrics3dFontFamilyCjk)
  const [fonts, setFonts] = useState<SystemFontFamily[]>([])
  const [fontsLoading, setFontsLoading] = useState(true)
  const [fontsError, setFontsError] = useState(false)
  const [fontAttempt, setFontAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setFontsLoading(true)
    setFontsError(false)
    void (async () => {
      try {
        const result = await window.desktop?.listSystemFonts()
        if (cancelled) return
        setFonts(result?.fonts ?? [])
        setFontsError(!result?.ok)
      } catch {
        if (!cancelled) setFontsError(true)
      } finally {
        if (!cancelled) setFontsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [fontAttempt])
  const patch = (key: keyof Lyrics3dParams) => (value: number) => setParams({ [key]: value })
  return (
    <div className={styles.embedded} aria-label="粒光设置">
      <div className={styles.menuTabs} role="tablist" aria-label="粒光选项">
        {([['text', '文字'], ['scene', '氛围'], ['quality', '画质']] as const).map(([id, label]) =>
          <button key={id} type="button" role="tab" id={`${panelId}-${id}`} aria-selected={tab === id}
            aria-controls={`${panelId}-panel`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div id={`${panelId}-panel`} role="tabpanel" aria-labelledby={`${panelId}-${tab}`} className={styles.panel}>
        {tab === 'text' && <>
          <div className={styles.styleGrid} role="group" aria-label="文字演出">
            {LYRIC_STYLES.map(style => <button key={style.id} type="button" aria-pressed={activeStyle === style.id}
              title={style.hint} onClick={() => setStyle(style.id)}>{style.icon}<span>{style.label}</span></button>)}
          </div>
          <div className={styles.fontPair}>
            <div><label htmlFor={`${panelId}-western`}>西文字体</label>
              <SystemFontPicker id={`${panelId}-western`} ariaLabel="粒光歌词西文字体" value={westernFont}
                fonts={fonts} loading={fontsLoading} defaultLabel="跟随界面" onChange={setWesternFont} /></div>
            <div><label htmlFor={`${panelId}-cjk`}>中文字体</label>
              <SystemFontPicker id={`${panelId}-cjk`} ariaLabel="粒光歌词中文字体" value={cjkFont}
                fonts={fonts} loading={fontsLoading} defaultLabel="跟随界面" onChange={setCjkFont} /></div>
          </div>
          {fontsError && <p className={styles.hint}>系统字体读取失败。<button type="button" className={styles.retry} onClick={() => setFontAttempt(value => value + 1)}>重试</button></p>}
          <LyricOptionGroup label="同屏歌词" options={[
              { value: 'single', label: '1 行' }, { value: 'dual', label: '2 行' }, { value: 'triple', label: '3 行' }, { value: 'cinema', label: '5 行' },
            ]} value={params.displayMode} onChange={value => setParams({ displayMode: value })} />
          <TuningSlider label="前后歌词亮度" value={params.contextOpacity} min={0.25} max={1} step={0.01} onChange={patch('contextOpacity')} />
          <TuningSlider label="歌词行间距" value={params.contextSpread} min={0.6} max={2.4} step={0.02}
            format={v => `${v.toFixed(2)}×`} onChange={patch('contextSpread')} />
          <TuningSlider label="远处歌词渐隐" value={params.edgeFade} min={0} max={1} step={0.01} onChange={patch('edgeFade')} />
          <TuningSlider label="切换柔和度" value={params.motionSoftness} min={0.15} max={1.2} step={0.01}
            format={v => `${v.toFixed(2)}×`} onChange={patch('motionSoftness')} />
        </>}
        {tab === 'scene' && <>
          <TuningSlider label="粒子数量" value={params.particleCount} min={0.25} max={2} step={0.05} onChange={patch('particleCount')} />
          <TuningSlider label="粒子大小" value={params.particleSize} min={0.2} max={2} step={0.05} onChange={patch('particleSize')} />
          <TuningSlider label="场景亮度" value={params.particleBrightness} min={0.3} max={2} step={0.05} onChange={patch('particleBrightness')} />
          <TuningSlider label="动效强度" value={params.motionIntensity} min={0.2} max={2} step={0.05} onChange={patch('motionIntensity')} />
          <TuningSlider label="辉光强度" value={params.glowStrength} min={0} max={2} step={0.05} onChange={patch('glowStrength')} />
          <div className={styles.tuningDivider}>鼓点波纹</div>
          <TuningSlider label="荡漾幅度" value={params.rippleAmplitude} min={0} max={1} step={0.01}
            format={v => v === 0 ? '关闭' : v <= 0.33 ? '轻柔' : v <= 0.66 ? '明显' : '强烈'} onChange={patch('rippleAmplitude')} />
          <TuningSlider label="触发灵敏度" value={params.rippleSensitivity} min={0} max={1} step={0.01} onChange={patch('rippleSensitivity')} />
          <TuningSlider label="扩散时长" value={params.rippleDuration} min={0.2} max={1.5} step={0.05}
            format={v => `${v.toFixed(2)}s`} onChange={patch('rippleDuration')} />
        </>}
        {tab === 'quality' && <>
          <LyricOptionGroup label="帧率上限" options={[
            { value: 60, label: '60' }, { value: 120, label: '120' }, { value: 0, label: '不限' },
          ]} value={params.fpsCap} onChange={value => setParams({ fpsCap: value })} />
          <TuningSlider label="渲染分辨率" value={params.renderScale} min={0.75} max={2} step={0.05}
            format={v => `${v.toFixed(2)}×`} onChange={patch('renderScale')} />
          <button type="button" className={styles.reset} onClick={resetParams}>恢复粒光默认</button>
        </>}
      </div>
    </div>
  )
}
