import { useId, type CSSProperties } from 'react'
import { fontFamilyCssValue } from '../../lib/font-family'
import { useSettingsStore } from '../../stores/settings'
import { useVisualStore } from '../../stores/visual'
import { InfoButton } from '../ui/InfoButton'
import { Switch } from '../ui/Switch'
import styles from './DesktopLyricsSettings.module.css'

const COLORS = [
  { value: '#ffffff', label: '白色' },
  { value: '#ffe29a', label: '暖黄' },
  { value: '#a9ddff', label: '浅蓝' },
  { value: '#c2f0cf', label: '浅绿' },
  { value: '#ffc2d6', label: '浅粉' }
]

export function DesktopLyricsSettings() {
  const fx = useVisualStore((s) => s.fx)
  const updateFx = useVisualStore((s) => s.updateFx)
  const interfaceFontFamily = useSettingsStore((s) => s.fontFamily)
  const interfaceFontFamilyCjk = useSettingsStore((s) => s.fontFamilyCjk)
  const id = useId()
  const color = fx.desktopLyricsColor || '#ffffff'
  const backgroundOpacity = fx.desktopLyricsBackgroundOpacity ?? 0.68
  const platform = typeof window !== 'undefined' ? window.desktop?.platform : undefined
  const supportsFrosted = platform === undefined || platform === 'darwin'
  const backgroundStyle = supportsFrosted ? fx.desktopLyricsBackgroundStyle || 'dark' : 'dark'
  const lineMode = fx.desktopLyricsLineMode || 'single'
  const previewLine = '让音乐陪你走过每一天'
  const previewBackgroundStyle = {
    backgroundColor: `rgba(24, 27, 32, ${backgroundOpacity})`,
    backdropFilter: backgroundStyle === 'frosted' ? 'blur(16px)' : 'none',
    WebkitBackdropFilter: backgroundStyle === 'frosted' ? 'blur(16px)' : 'none'
  } as CSSProperties
  const previewStyle = {
    fontFamily: fontFamilyCssValue(fx.desktopLyricsFontFamily || interfaceFontFamily, fx.desktopLyricsFontFamilyCjk || interfaceFontFamilyCjk),
    color,
    opacity: fx.desktopLyricsOpacity,
    '--lyrics-preview-color': color
  } as CSSProperties

  return (
    <section className={styles.card} aria-labelledby={`${id}-heading`}>
      <header className={styles.header}>
        <div>
          <h3 id={`${id}-heading`}>桌面歌词</h3>

        </div>
        <Switch checked={fx.desktopLyrics} onChange={(value) => updateFx({ desktopLyrics: value })} aria-label="启用桌面歌词" />
      </header>

      <div className={styles.preview}>
        <div className={styles.previewBackdrop} style={previewBackgroundStyle} />
        <span className={styles.previewLabel}>歌词与底框预览</span>
        <div className={`${styles.previewText} ${fx.desktopLyricsHighlight ? styles.glow : ''}`} style={previewStyle}>
          <span className={styles.previewLine}>{fx.desktopLyricsWordByWord ? <><span>{previewLine.slice(0, 4)}</span><span className={styles.previewPending}>{previewLine.slice(4)}</span></> : previewLine}</span>
          {lineMode === 'double' && <span className={`${styles.previewLine} ${styles.previewNext}`}>下一句，也有音乐相伴</span>}
          {fx.desktopLyricsShowRoma && <span className={styles.previewTranslation}>ràng yīn yuè péi nǐ zǒu guò měi yì tiān</span>}
          {fx.desktopLyricsShowTranslation && <span className={styles.previewTranslation}>Let music be with you every day</span>}
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.settings}>
          <h4 className={styles.sectionTitle}>文字外观</h4>
          <div className={styles.sizeSetting}>
            <div className={styles.labelLine}>
              <span className={styles.settingLabel}><label htmlFor={`${id}-size`}>字体大小</label><InfoButton label="桌面歌词字体大小" text="拖动歌词框调整高度，文字会跟着缩放；横向拉宽不会改变字号。" align="left" /></span>
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
          </div>

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
          <div className={styles.opacitySetting}>
            <div className={styles.labelLine}>
              <label htmlFor={`${id}-opacity`}>文字不透明度</label>
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
            <span>文字发光</span>
            <Switch checked={fx.desktopLyricsHighlight} onChange={(value) => updateFx({ desktopLyricsHighlight: value })} aria-label="桌面歌词文字发光" />
          </div>
        </div>
        <div className={styles.settings}>
          <h4 className={styles.sectionTitle}>歌词内容</h4>
          <div className={styles.row}>
            <span className={styles.settingLabel}>显示行数<InfoButton label="桌面歌词显示行数" text="双行显示当前句与下一句歌词。" align="left" /></span>
            <div className={styles.choices} role="group" aria-label="桌面歌词显示行数">
              <button type="button" className="no-drag" aria-pressed={lineMode === 'single'} onClick={() => updateFx({ desktopLyricsLineMode: 'single' })}>单行</button>
              <button type="button" className="no-drag" aria-pressed={lineMode === 'double'} onClick={() => updateFx({ desktopLyricsLineMode: 'double' })}>双行</button>
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.settingLabel}>逐字高亮<InfoButton label="桌面歌词逐字高亮" text="歌曲没有逐字时间数据时，仍按整句显示。" align="left" /></span>
            <Switch checked={fx.desktopLyricsWordByWord ?? false} onChange={(value) => updateFx({ desktopLyricsWordByWord: value })} aria-label="桌面歌词逐字高亮" />
          </div>
          <div className={styles.row}>
            <span>显示翻译</span>
            <Switch checked={fx.desktopLyricsShowTranslation} onChange={(value) => updateFx({ desktopLyricsShowTranslation: value })} aria-label="桌面歌词显示翻译" />
          </div>
          <div className={styles.row}>
            <span>显示音译</span>
            <Switch checked={fx.desktopLyricsShowRoma} onChange={(value) => updateFx({ desktopLyricsShowRoma: value })} aria-label="桌面歌词显示音译" />
          </div>
        </div>
        <div className={styles.settings}>
          <h4 className={styles.sectionTitle}>底框与位置</h4>
          <div className={styles.opacitySetting}>
            <div className={styles.labelLine}>
              <label htmlFor={`${id}-background-opacity`}>底框不透明度</label>
              <output htmlFor={`${id}-background-opacity`}>{Math.round(backgroundOpacity * 100)}%</output>
            </div>
            <input
              id={`${id}-background-opacity`}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={backgroundOpacity}
              aria-valuetext={`${Math.round(backgroundOpacity * 100)}%`}
              onChange={(event) => updateFx({ desktopLyricsBackgroundOpacity: Number(event.target.value) })}
              className="no-drag"
            />
          </div>
          <div className={styles.row}>
            <span className={styles.settingLabel}>底框效果<InfoButton label="桌面歌词底框效果" text={`${!supportsFrosted ? '此系统使用暗灰色底框。' : ''}底框常态显示，锁定后也保留；设为 0% 可隐藏底框。`} align="left" /></span>
            <div className={styles.choices} role="group" aria-label="桌面歌词底框效果">
              <button type="button" className="no-drag" disabled={!supportsFrosted} title={!supportsFrosted ? '此系统使用暗灰色底框' : undefined} aria-pressed={backgroundStyle === 'frosted'} onClick={() => updateFx({ desktopLyricsBackgroundStyle: 'frosted' })}>毛玻璃</button>
              <button type="button" className="no-drag" aria-pressed={backgroundStyle === 'dark'} onClick={() => updateFx({ desktopLyricsBackgroundStyle: 'dark' })}>暗灰色</button>
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.settingLabel}>宽度自适应<InfoButton label="桌面歌词宽度自适应" text="宽度跟随最长一行歌词，超出屏幕时显示省略号；关闭后恢复手动宽度。" align="left" /></span>
            <Switch checked={fx.desktopLyricsAutoWidth ?? false} onChange={(value) => updateFx({ desktopLyricsAutoWidth: value })} aria-label="桌面歌词宽度自适应" />
          </div>
          <div className={styles.lockSetting}>
            <div className={styles.row}>
              <span className={styles.settingLabel}>锁定位置<InfoButton label="锁定桌面歌词" text="移到歌词上可拖动，左上角可缩放；锁定后鼠标可穿透。悬停歌词 0.5 秒，点击出现的解锁图标即可调整。" align="left" /></span>
              <Switch checked={fx.desktopLyricsClickThrough} onChange={(value) => updateFx({ desktopLyricsClickThrough: value })} aria-label="锁定桌面歌词" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
