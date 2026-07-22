import { Children, type ReactNode } from 'react'
import { useScrollReveal } from '../../hooks/useScrollReveal'
import { GradientText } from '../ui/GradientText'
import styles from './CardRail.module.css'

interface CardRailProps {
  title: string
  children: ReactNode
}

export function CardRail({ title, children }: CardRailProps) {
  const ref = useScrollReveal<HTMLElement>()
  return (
    <section className={styles.section} ref={ref}>
      <h2 className={styles.title}><GradientText>{title}</GradientText></h2>
      <div
        className={styles.rail}
        onWheel={(e) => {
          e.preventDefault()
          e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {/* 用独立包裹层约束宽度，避免和子组件自身的 width:100% 样式打层叠优先级架 */}
        {Children.map(children, (child) => <div className={styles.item}>{child}</div>)}
      </div>
    </section>
  )
}
