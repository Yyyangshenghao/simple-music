import { motion } from 'motion/react'
import { springSnappy, springGentle } from '../../lib/motion-presets'
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
  hidden?: boolean
}

export function EffectSwitcher({ hidden }: EffectSwitcherProps) {
  const active = useSettingsStore((s) => s.lyrics3dEffect)
  const setEffect = useSettingsStore((s) => s.setLyrics3dEffect)

  return (
    <motion.div
      className={`${styles.switcher}${hidden ? ` ${styles.hidden}` : ''}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springGentle}
    >
      {EFFECTS.map((eff) => (
        <button
          key={eff.id}
          className={`${styles.btn}${active === eff.id ? ` ${styles.active}` : ''}`}
          onClick={() => setEffect(eff.id)}
          title={eff.label}
          aria-label={eff.label}
        >
          <motion.span
            className={styles.icon}
            whileTap={{ scale: 0.88 }}
            transition={springSnappy}
          >
            {eff.icon}
          </motion.span>
        </button>
      ))}
    </motion.div>
  )
}
