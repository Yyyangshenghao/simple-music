import { useId } from 'react'
import { motion, type Transition } from 'motion/react'
import { liquidPillSpring, springBouncy, springSnappy, tapScale } from '../../lib/motion-presets'
import { useMotion } from '../../hooks/useMotion'
import styles from './ThemeModePicker.module.css'

export type ThemeMode = 'auto' | 'light' | 'dark'

const MODES: Array<{ value: ThemeMode; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const RAYS = Array.from({ length: 8 }, (_, i) => i * 45)
const INSTANT: Transition = { duration: 0 }

/** 太阳：选中时内核点亮成实心，光芒依次伸长并转正。 */
function SunIcon({ active, motionOff }: { active: boolean; motionOff: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <motion.circle
        cx="12" cy="12" stroke="currentColor" strokeWidth="1.6"
        initial={false}
        animate={{ r: active ? 4.4 : 3.8, fillOpacity: active ? 1 : 0 }}
        fill="currentColor"
        transition={motionOff ? INSTANT : springSnappy}
      />
      <motion.g
        style={{ originX: 0.5, originY: 0.5 }}
        initial={false}
        animate={{ rotate: active ? 0 : -30 }}
        transition={motionOff ? INSTANT : springBouncy}
      >
        {RAYS.map((deg, i) => (
          <motion.line
            key={deg}
            x1="12" x2="12" y2="5.4"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            transform={`rotate(${deg} 12 12)`}
            initial={false}
            animate={{ y1: active ? 2.8 : 4.3, opacity: active ? 1 : 0.75 }}
            transition={motionOff ? INSTANT : { ...springSnappy, delay: active ? i * 0.025 : 0 }}
          />
        ))}
      </motion.g>
    </svg>
  )
}

/** 月亮：选中时遮罩圆滑入切出新月并填实，旁边两颗星先后闪现。 */
function MoonIcon({ active, motionOff }: { active: boolean; motionOff: boolean }) {
  const maskId = useId()
  const t = (delay = 0): Transition => motionOff ? INSTANT : { ...springBouncy, delay }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <mask id={maskId}>
        <rect width="24" height="24" fill="#fff" />
        <motion.circle
          r="6.6" fill="#000"
          initial={false}
          animate={{ cx: active ? 15.6 : 18.4, cy: active ? 8.2 : 6.6 }}
          transition={t()}
        />
      </mask>
      <motion.g
        style={{ originX: 0.5, originY: 0.5 }}
        initial={false}
        animate={{ rotate: active ? 0 : 18 }}
        transition={t()}
      >
        <motion.circle
          cx="11" cy="13" r="7"
          mask={`url(#${maskId})`}
          fill="currentColor"
          initial={false}
          animate={{ fillOpacity: active ? 1 : 0.32 }}
          transition={motionOff ? INSTANT : springSnappy}
        />
      </motion.g>
      <motion.path
        d="M18.5 3.2l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z"
        fill="currentColor"
        style={{ originX: 0.5, originY: 0.5 }}
        initial={false}
        animate={{ scale: active ? 1 : 0, opacity: active ? 1 : 0 }}
        transition={t(active ? 0.08 : 0)}
      />
      <motion.circle
        cx="21" cy="9.6" r="0.75" fill="currentColor"
        initial={false}
        animate={{ scale: active ? 1 : 0, opacity: active ? 0.8 : 0 }}
        transition={t(active ? 0.16 : 0)}
      />
    </svg>
  )
}

/** 跟随系统：半明半暗的圆，选中时转过半圈，明暗分界从竖向转到斜向。 */
function AutoIcon({ active, motionOff }: { active: boolean; motionOff: boolean }) {
  const clipId = useId()
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <motion.g
        style={{ originX: 0.5, originY: 0.5 }}
        initial={false}
        animate={{ rotate: active ? 225 : 45 }}
        transition={motionOff ? INSTANT : springBouncy}
      >
        <clipPath id={clipId}><rect x="0" y="0" width="12" height="24" /></clipPath>
        <circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <motion.circle
          cx="12" cy="12" r="7.2" fill="currentColor" clipPath={`url(#${clipId})`}
          initial={false}
          animate={{ fillOpacity: active ? 1 : 0.45 }}
          transition={motionOff ? INSTANT : springSnappy}
        />
      </motion.g>
    </svg>
  )
}

const ICONS = { auto: AutoIcon, light: SunIcon, dark: MoonIcon }

/** 主题模式图标分段控件：玻璃胶囊指示器在三项间弹簧滑动，图标各自带进入选中态的小动画。 */
export function ThemeModePicker({ value, onChange }: { value: ThemeMode; onChange(mode: ThemeMode): void }) {
  const motionOff = !useMotion('controlMotion')
  const groupId = useId()
  return (
    <div className={`${styles.root} no-drag`} role="radiogroup" aria-label="主题模式">
      {MODES.map(({ value: mode, label }) => {
        const active = value === mode
        const Icon = ICONS[mode]
        return (
          <motion.button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            className={`${styles.option}${active ? ` ${styles.active}` : ''}`}
            onClick={() => onChange(mode)}
            whileTap={motionOff ? undefined : tapScale}
            transition={springSnappy}
          >
            {active && (
              <motion.span
                layoutId={`${groupId}-pill`}
                className={styles.pill}
                transition={motionOff ? INSTANT : { type: 'spring', ...liquidPillSpring }}
              />
            )}
            <span className={styles.icon}><Icon active={active} motionOff={motionOff} /></span>
          </motion.button>
        )
      })}
    </div>
  )
}
