import { forwardRef, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { animate, motion, motionValue, useTransform, type HTMLMotionProps, type MotionValue } from 'motion/react'
import { useMotion } from '../../hooks/useMotion'
import { jellyRadio } from '../../lib/motion-presets'
import styles from './JellyRadio.module.css'

export interface JellyRadioItem<T extends string = string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
  title?: string
  ariaLabel?: string
}

interface JellyRadioProps<T extends string> {
  items: JellyRadioItem<T>[]
  /** 当前选中值；不在 items 里时视为都未选中。 */
  value: T | null
  onChange(value: T): void
  ariaLabel: string
  size?: 'sm' | 'md'
  /** 撑满一行，各项等宽。 */
  block?: boolean
  disabled?: boolean
  className?: string
}

interface ChipValues {
  x: MotionValue<number>
  sx: MotionValue<number>
  sy: MotionValue<number>
}

const spring = (k: number, m: number, bounce: number) => ({
  type: 'spring' as const,
  stiffness: k,
  damping: 2 * Math.sqrt(k * m) * (1 - bounce),
  mass: m,
})

const Chip = forwardRef<HTMLButtonElement, HTMLMotionProps<'button'> & { mv: ChipValues }>(function Chip({ mv, children, ...rest }, ref) {
  const transform = useTransform(() => `translateX(${mv.x.get()}px) scale(${mv.sx.get()}, ${mv.sy.get()})`)
  return <motion.button ref={ref} style={{ transform }} {...rest}>{children}</motion.button>
})

/**
 * 果冻单选（参考 React Bits JellyRadio）：一排胶囊，选中的一项鼓起并把两侧邻居挤开，
 * 横纵向错拍回弹出果冻感；方向键 / Home / End 切换。减弱动态时直接落位。
 */
export function JellyRadio<T extends string>({ items, value, onChange, ariaLabel, size = 'md', block, disabled, className }: JellyRadioProps<T>) {
  const at = items.findIndex(it => it.value === value)
  const reduce = !useMotion('toggleMotion')
  const groupRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([])
  const widths = useRef<number[]>([])
  const mvs = useRef<ChipValues[]>([])
  const applied = useRef(at)
  const count = useRef(items.length)
  count.current = items.length
  const reduceRef = useRef(reduce)
  reduceRef.current = reduce
  const itemsKey = items.map(it => it.value).join('|')

  const mvFor = (i: number) => {
    let mv = mvs.current[i]
    if (!mv) {
      mv = { x: motionValue(0), sx: motionValue(1), sy: motionValue(1) }
      mvs.current[i] = mv
    }
    return mv
  }

  const apply = (sel: number, instant: boolean) => {
    const { swell, barge, shrink, jelly, bounce, stagger, stiffness } = jellyRadio
    const push = sel < 0 ? 0 : ((widths.current[sel] ?? 0) * swell) / 2 + barge
    for (let i = 0; i < count.current; i++) {
      const mv = mvFor(i)
      const far = sel < 0 ? 0 : Math.abs(i - sel)
      const x = sel < 0 ? 0 : Math.sign(i - sel) * push
      const s = sel < 0 ? 1 : i === sel ? 1 + swell : 1 - shrink
      if (instant || reduceRef.current) {
        mv.x.jump(x)
        mv.sx.jump(s)
        mv.sy.jump(s)
        continue
      }
      const k = stiffness * (1 - 0.12 * Math.min(far, 3))
      const inFlight = mv.x.isAnimating() || mv.sx.isAnimating() || mv.sy.isAnimating()
      const delay = inFlight ? 0 : (far * stagger) / 1000
      animate(mv.x, x, { ...spring(k, 0.9, bounce), delay })
      animate(mv.sx, s, { ...spring(k * (1 + 0.24 * jelly), 0.9 - 0.1 * jelly, Math.min(0.85, bounce + 0.3 * jelly)), delay })
      animate(mv.sy, s, { ...spring(k * (1 - 0.14 * jelly), 0.9 + 0.05 * jelly, bounce), delay: delay + 0.05 * jelly })
    }
  }

  // 按最宽一项预留两侧空间，选中项鼓起、邻居被挤开时不被裁掉
  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return
    const settle = () => {
      widths.current = chipRefs.current.slice(0, count.current).map(el => el?.offsetWidth ?? 0)
      const chipH = chipRefs.current[0]?.offsetHeight ?? 0
      const maxW = Math.max(0, ...widths.current)
      group.style.setProperty('--jr-pad-x', `${Math.ceil((maxW * jellyRadio.swell * 1.3) / 2 + jellyRadio.barge) + 2}px`)
      group.style.setProperty('--jr-pad-y', `${Math.ceil((chipH * jellyRadio.swell) / 2) + 2}px`)
      apply(applied.current, true)
    }
    settle()
    const observer = new ResizeObserver(settle)
    observer.observe(group)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, size])

  // 外部改值（其他入口、换曲）时直接落位，不演动画
  useEffect(() => {
    if (applied.current === at) return
    applied.current = at
    apply(at, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])

  useEffect(() => () => mvs.current.forEach(mv => { mv.x.destroy(); mv.sx.destroy(); mv.sy.destroy() }), [])

  const commit = (i: number, instant: boolean) => {
    const item = items[i]
    if (disabled || i === at || !item || item.disabled) return
    applied.current = i
    apply(i, instant)
    onChange(item.value)
  }
  const stepFrom = (i: number, dir: number) => {
    const n = items.length
    let j = i
    for (let tries = 0; tries < n; tries++) {
      j = (j + dir + n) % n
      if (!items[j].disabled) return j
    }
    return i
  }
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = stepFrom(i, 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = stepFrom(i, -1)
    else if (e.key === 'Home') next = stepFrom(-1, 1)
    else if (e.key === 'End') next = stepFrom(items.length, -1)
    if (next === null) return
    e.preventDefault()
    commit(next, true)
    chipRefs.current[next]?.focus()
  }
  const focusable = at >= 0 ? at : items.findIndex(it => !it.disabled)

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={`${styles.group} no-drag${className ? ` ${className}` : ''}`}
      data-size={size}
      data-block={block || undefined}
      data-disabled={disabled || undefined}
    >
      {items.map((it, i) => (
        <Chip
          key={it.value}
          mv={mvFor(i)}
          ref={el => { chipRefs.current[i] = el }}
          type="button"
          role="radio"
          aria-checked={i === at}
          aria-label={it.ariaLabel}
          title={it.title}
          tabIndex={i === focusable ? 0 : -1}
          disabled={disabled || it.disabled}
          className={styles.chip}
          data-on={i === at}
          onClick={e => commit(i, e.detail === 0)}
          onKeyDown={e => onKeyDown(e, i)}
        >
          <span className={styles.skin}>
            {it.icon && <span className={styles.icon}>{it.icon}</span>}
            <span className={styles.label}>{it.label}</span>
          </span>
        </Chip>
      ))}
    </div>
  )
}
