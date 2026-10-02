import { useId, type CSSProperties } from 'react'
import { fontFamilyCssValue } from '../../lib/font-family'
import { useVisualStore } from '../../stores/visual'
import type { SystemFontFamily } from '../../types/ipc'
import { Switch } from '../ui/Switch'
import { SystemFontPicker } from '../ui/SystemFontPicker'
import styles from './DesktopLyricsSettings.module.css'

const COLORS = [
  { value: '#ffffff', label: '白色' },
  { value: '#ffe29a', label: '暖黄' },
  { value: '#a9ddff', label: '浅蓝' },
  { value: '#c2f0cf', label: '浅绿' },
  { value: '#ffc2d6', label: '浅粉' }
]

interface DesktopLyricsSettingsProps {
  fonts: SystemFontFamily[]
  loading: boolean
  fontsError: boolean
  onRetryFonts(): void
}

export function DesktopLyricsSettings({ fonts, loading, fontsError, onRetryFonts }: DesktopLyricsSettingsProps) {
  const fx = useVisualStore((s) => s.fx)
  const updateFx = useVisualStore((s) => s.updateFx)
  const id = useId()
  const color = fx.desktopLyricsColor || '#ffffff'
  const previewStyle = {
    fontFamily: fontFamilyCssValue(fx.desktopLyricsFontFamily || ''),
    color,
    opacity: fx.desktopLyricsOpacity,
    '--lyrics-preview-color': color
  } as CSSProperties

  return (
    <section className={styles.card} aria-labelledby={`${id}-heading`}>
      <header className={styles.header}>
        <div>
          <h3 id={`${id}-heading`}>桌面歌词</h3>
          <p>字体、颜色与显示方式，修改后立即生效。</p>
        </div>
        <Switch checked={fx.desktopLyrics} onChange={(value) => updateFx({ desktopLyrics: value })} aria-label="启用桌面歌词" />
      </header>

      <div className={styles.preview}>
        <span className={styles.previewLabel}>字体与颜色预览</span>
        <div className={`${styles.previewText} ${fx.desktopLyricsHighlight ? styles.glow : ''}`} style={previewStyle}>
          <span className={styles.previewLine}>{fx.desktopLyricsShowRoma ? '音楽と、毎日を。' : '让音乐陪你走过每一天'}</span>
          {fx.desktopLyricsShowRoma && <span className={styles.previewTranslation}>ongaku to, mainichi o.</span>}
          {fx.desktopLyricsShowTranslation && <span className={styles.previewTranslation}>{fx.desktopLyricsShowRoma ? '让音乐陪你走过每一天' : 'Let music be with you every day'}</span>}
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.settings}>
          <div className={styles.sizeSetting}>
            <div className={styles.labelLine}>
              <label htmlFor={`${id}-size`}>字体大小</label>
              <output htmlFor={`${id}-size`}>{Math.round(fx.desktopLyricsSize)} px</output>
            </div>
            <input
              id={`${id}-size`}
              type="range"
              min={12}
              max={Math.max(160, Math.ceil(fx.desktopLyricsSize))}
              step={1}
              value={fx.desktopLyricsSize}
              aria-valuetext={`${Math.round(fx.desktopLyricsSize)}像素`}
              onChange={(event) => updateFx({ desktopLyricsSize: Number(event.target.value) })}
              className="no-drag"
            />
            <p className={styles.hint}>拖动歌词框调整高度，文字会跟着缩放；横向拉宽不会改变字号。</p>
          </div>

          <div className={styles.row}>
            <label htmlFor={`${id}-font`}>字体</label>
            <SystemFontPicker
              id={`${id}-font`}
              value={fx.desktopLyricsFontFamily || ''}
              fonts={fonts}
              loading={loading}
              defaultLabel="系统默认"
              ariaLabel="桌面歌词字体"
              onChange={(value) => updateFx({ desktopLyricsFontFamily: value })}
            />
          </div>
          {fontsError && (
            <div className={styles.fontError} role="status">
              字体读取失败
              <button type="button" onClick={onRetryFonts} disabled={loading} className="no-drag">重新读取</button>
            </div>
          )}

          <div className={styles.colorSetting}>
            <label htmlFor={`${id}-color`}>字体颜色</label>
            <div className={styles.colors}>
              {COLORS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`${styles.swatch} no-drag`}
                  style={{ '--swatch-color': preset.value } as CSSProperties}
                  aria-label={`桌面歌词${preset.label}`}
                  aria-pressed={color.toLowerCase() === preset.value}
                  title={preset.label}
                  onClick={() => updateFx({ desktopLyricsColor: preset.value })}
                />
              ))}
              <label className={`${styles.customColor} no-drag`} htmlFor={`${id}-color`}>
                <input
                  id={`${id}-color`}
                  type="color"
                  value={color}
                  aria-label="自定义桌面歌词颜色"
                  onChange={(event) => updateFx({ desktopLyricsColor: event.target.value })}
                />
                <span>自定义</span>
              </label>
            </div>
          </div>
        </div>

        <div className={styles.settings}>
          <div className={styles.opacitySetting}>
            <div className={styles.labelLine}>
              <label htmlFor={`${id}-opacity`}>不透明度</label>
              <output htmlFor={`${id}-opacity`}>{Math.round(fx.desktopLyricsOpacity * 100)}%</output>
            </div>
            <input
              id={`${id}-opacity`}
              type="range"
              min={0.28}
              max={1}
              step={0.01}
              value={fx.desktopLyricsOpacity}
              aria-valuetext={`${Math.round(fx.desktopLyricsOpacity * 100)}%`}
              onChange={(event) => updateFx({ desktopLyricsOpacity: Number(event.target.value) })}
              className="no-drag"
            />
          </div>
          <div className={styles.row}>
            <span>显示翻译</span>
            <Switch checked={fx.desktopLyricsShowTranslation} onChange={(value) => updateFx({ desktopLyricsShowTranslation: value })} aria-label="桌面歌词显示翻译" />
          </div>
          <div className={styles.row}>
            <span>显示音译</span>
            <Switch checked={fx.desktopLyricsShowRoma} onChange={(value) => updateFx({ desktopLyricsShowRoma: value })} aria-label="桌面歌词显示音译" />
          </div>
          <p className={styles.hint}>歌曲提供音译歌词时显示。</p>
          <div className={styles.row}>
            <span>文字发光</span>
            <Switch checked={fx.desktopLyricsHighlight} onChange={(value) => updateFx({ desktopLyricsHighlight: value })} aria-label="桌面歌词文字发光" />
          </div>
          <div className={styles.lockSetting}>
            <div className={styles.row}>
              <span>锁定位置</span>
              <Switch checked={fx.desktopLyricsClickThrough} onChange={(value) => updateFx({ desktopLyricsClickThrough: value })} aria-label="锁定桌面歌词" />
            </div>
            <p className={styles.hint}>{fx.desktopLyricsClickThrough
              ? '悬停歌词 0.5 秒，点击出现的解锁图标即可调整。'
              : '移到歌词上可拖动，左上角可缩放；锁定后鼠标可穿透。'}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
