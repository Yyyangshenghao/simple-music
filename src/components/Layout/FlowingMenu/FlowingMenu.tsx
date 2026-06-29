// src/components/Layout/FlowingMenu/FlowingMenu.tsx
import { useRef, useEffect, useState } from 'react'
import gsap from 'gsap'
import styles from './FlowingMenu.module.css'

export interface FlowingMenuItem {
  text: string
  active?: boolean
  onClick: () => void
}

export interface FlowingMenuProps {
  items: FlowingMenuItem[]
  speed?: number
  textColor?: string
  bgColor?: string
  marqueeBgColor?: string
  marqueeTextColor?: string
  borderColor?: string
}

export function FlowingMenu({
  items = [],
  speed = 12,
  textColor = 'var(--sm-text-primary)',
  bgColor = 'transparent',
  marqueeBgColor = 'var(--sm-accent)',
  marqueeTextColor = 'var(--sm-text-on-accent)',
  borderColor = 'var(--sm-border)',
}: FlowingMenuProps) {
  return (
    <div className={styles.menuWrap} style={{ backgroundColor: bgColor }}>
      <nav className={styles.menu}>
        {items.map((item, idx) => (
          <FlowingMenuItemComponent
            key={idx}
            item={item}
            speed={speed}
            textColor={textColor}
            marqueeBgColor={marqueeBgColor}
            marqueeTextColor={marqueeTextColor}
            borderColor={borderColor}
          />
        ))}
      </nav>
    </div>
  )
}

interface ItemProps {
  item: FlowingMenuItem
  speed: number
  textColor: string
  marqueeBgColor: string
  marqueeTextColor: string
  borderColor: string
}

function FlowingMenuItemComponent({ item, speed, textColor, marqueeBgColor, marqueeTextColor, borderColor }: ItemProps) {
  const itemRef = useRef<HTMLDivElement>(null)
  const marqueeRef = useRef<HTMLDivElement>(null)
  const marqueeInnerRef = useRef<HTMLDivElement>(null)
  const marqueeAnimRef = useRef<gsap.core.Tween | null>(null)
  const [repetitions, setRepetitions] = useState(6)

  function findClosestEdge(mouseX: number, mouseY: number, width: number, height: number): 'top' | 'bottom' {
    const topDist = (mouseX - width / 2) ** 2 + mouseY ** 2
    const bottomDist = (mouseX - width / 2) ** 2 + (mouseY - height) ** 2
    return topDist < bottomDist ? 'top' : 'bottom'
  }

  useEffect(() => {
    const calc = () => {
      const part = marqueeInnerRef.current?.querySelector(`.${styles.marqueePart}`) as HTMLElement | null
      if (!part) return
      const w = part.offsetWidth
      if (w === 0) return
      const needed = Math.ceil(window.innerWidth / w) + 3
      setRepetitions(Math.max(6, needed))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [item.text])

  useEffect(() => {
    const part = marqueeInnerRef.current?.querySelector(`.${styles.marqueePart}`) as HTMLElement | null
    if (!part) return
    const w = part.offsetWidth
    if (w === 0) return
    if (marqueeAnimRef.current) marqueeAnimRef.current.kill()
    marqueeAnimRef.current = gsap.to(marqueeInnerRef.current, {
      x: -w,
      duration: speed,
      ease: 'none',
      repeat: -1,
    })
    return () => { marqueeAnimRef.current?.kill() }
  }, [item.text, repetitions, speed])

  function handleMouseEnter(ev: React.MouseEvent<HTMLButtonElement>) {
    if (!itemRef.current || !marqueeRef.current || !marqueeInnerRef.current) return
    const rect = itemRef.current.getBoundingClientRect()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    const edge = findClosestEdge(x, y, rect.width, rect.height)
    gsap.timeline({ defaults: { duration: 0.5, ease: 'expo.out' } })
      .set(marqueeRef.current, { y: edge === 'top' ? '-101%' : '101%' })
      .set(marqueeInnerRef.current, { y: edge === 'top' ? '101%' : '-101%' })
      .to([marqueeRef.current, marqueeInnerRef.current], { y: '0%' })
  }

  function handleMouseLeave(ev: React.MouseEvent<HTMLButtonElement>) {
    if (!itemRef.current || !marqueeRef.current || !marqueeInnerRef.current) return
    const rect = itemRef.current.getBoundingClientRect()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    const edge = findClosestEdge(x, y, rect.width, rect.height)
    gsap.timeline({ defaults: { duration: 0.4, ease: 'expo.out' } })
      .to(marqueeRef.current, { y: edge === 'top' ? '-101%' : '101%' })
      .to(marqueeInnerRef.current, { y: edge === 'top' ? '101%' : '-101%' }, '<')
  }

  return (
    <div className={styles.menuItem} ref={itemRef} style={{ borderColor }}>
      <button
        className={`${styles.menuItemLink} no-drag ${item.active ? styles.active : ''}`}
        style={{ color: textColor }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={item.onClick}
      >
        {item.text}
      </button>
      <div className={styles.marquee} ref={marqueeRef} style={{ backgroundColor: marqueeBgColor }}>
        <div className={styles.marqueeInnerWrap}>
          <div className={styles.marqueeInner} ref={marqueeInnerRef} aria-hidden="true">
            {Array.from({ length: repetitions }).map((_, idx) => (
              <div className={styles.marqueePart} key={idx} style={{ color: marqueeTextColor }}>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
