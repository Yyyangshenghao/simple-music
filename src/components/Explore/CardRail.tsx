import type { ReactNode } from 'react'
import styles from './CardRail.module.css'

interface CardRailProps {
  title: string
  children: ReactNode
}

export function CardRail({ title, children }: CardRailProps) {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>{title}</h2>
      <div
        className={styles.rail}
        onWheel={(e) => {
          e.preventDefault()
          e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {children}
      </div>
    </section>
  )
}
