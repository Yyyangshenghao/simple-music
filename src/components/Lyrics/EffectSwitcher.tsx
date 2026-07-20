import { motion } from 'motion/react'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import { useSettingsStore } from '../../stores/settings'
import type { Lyrics3dEffect } from '../../types/domain'
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

interface EffectSwitcherProps {
  onClose: () => void
}

/** 3D 按钮下拉菜单:选择封面粒子云/3D 频谱环/音箱沙粒三种效果,底部附舞台歌词开关 */
export function EffectSwitcher({ onClose }: EffectSwitcherProps) {
  const active = useSettingsStore((s) => s.lyrics3dEffect)
  const setEffect = useSettingsStore((s) => s.setLyrics3dEffect)
  const stage3d = useSettingsStore((s) => s.lyricsStage3d)
  const setStage3d = useSettingsStore((s) => s.setLyricsStage3d)

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
                onClose()
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
        <motion.button
          role="menuitemcheckbox"
          aria-checked={stage3d}
          className={`${styles.item}${stage3d ? ` ${styles.itemActive}` : ''}`}
          title="开:歌词悬浮在 3D 场景内;关:传统底部叠加歌词"
          onClick={() => setStage3d(!stage3d)}
          whileTap={tapScale}
          transition={springSnappy}
        >
          <span className={styles.icon}>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
              strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 14 L10 17 L17 14" />
              <path d="M3 10 L10 13 L17 10" />
              <path d="M5 6.5 H15" />
              <circle cx="3" cy="6.5" r="0.8" />
              <circle cx="17" cy="6.5" r="0.8" />
            </svg>
          </span>
          <span className={styles.label}>舞台歌词</span>
        </motion.button>
      </motion.div>
    </>
  )
}
