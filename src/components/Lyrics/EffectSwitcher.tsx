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
}

/** 3D 按钮下拉菜单：同屏行数、背景效果和歌词样式。 */
export function EffectSwitcher({ onClose }: EffectSwitcherProps) {
  const active = useSettingsStore((s) => s.lyrics3dEffect)
  const setEffect = useSettingsStore((s) => s.setLyrics3dEffect)
  const activeStyle = useSettingsStore((s) => s.lyrics3dStyle)
  const setStyle = useSettingsStore((s) => s.setLyrics3dStyle)
  const displayMode = useSettingsStore((s) => s.lyrics3d.displayMode)
  const setParams = useSettingsStore((s) => s.setLyrics3dParams)

  return (
    <>
      <div className={`${styles.backdrop} no-drag`} onClick={onClose} />
      <motion.div
        className={`${styles.menu} no-drag`}
        role="menu"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSnappy}
      >
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
        <div className={styles.sectionLabel}>场景效果</div>
        {EFFECTS.map((eff) => {
          const isActive = active === eff.id
          return (
            <motion.button
              key={eff.id}
              role="menuitemradio"
              aria-checked={isActive}
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
              role="menuitemradio"
              aria-checked={isActive}
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
      </motion.div>
    </>
  )
}
