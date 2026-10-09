import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { motion } from 'motion/react'
import styles from './ScrollArea.module.css'
import pageScroll from '../../styles/page-scroll.module.css'

interface ScrollAreaProps {
  children: ReactNode
  /** 应用到滚动容器本身的类名（内边距、定位等） */
  className?: string
  scrollRef?: RefObject<HTMLDivElement>
  /** 滚动距离超过阈值（8px）时触发，用于让吸顶元素在滚动后才显示背景 */
  onScrolledChange?: (scrolled: boolean) => void
}

const SCROLLED_THRESHOLD = 8

/** 复用全应用定制滚动条，保留滚动引用与共享布局动画。 */
export function ScrollArea({ children, className, scrollRef, onScrolledChange }: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const nodeRef = scrollRef ?? viewportRef
  const onScrolledChangeRef = useRef(onScrolledChange)
  onScrolledChangeRef.current = onScrolledChange

  useEffect(() => {
    const el = nodeRef.current
    if (!el) return
    let wasScrolled = el.scrollTop > SCROLLED_THRESHOLD
    onScrolledChangeRef.current?.(wasScrolled)

    function onScroll() {
      const scrolled = el!.scrollTop > SCROLLED_THRESHOLD
      if (scrolled !== wasScrolled) {
        wasScrolled = scrolled
        onScrolledChangeRef.current?.(scrolled)
      }
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [nodeRef])

  return (
    <div className={styles.root}>
      <motion.div layoutScroll ref={nodeRef} className={`${styles.viewport} ${pageScroll.viewport} ${className ?? ''}`}>
        {children}
      </motion.div>
    </div>
  )
}
