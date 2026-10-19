import { useEffect, useRef, useState, type RefObject } from 'react'

/** 卡片网格每批渲染数量；数据仍一次取齐，只分批挂载卡片。 */
export const PROGRESSIVE_BATCH = 48

/** 追加一批后的可见数量，不超过总数。 */
export function nextProgressiveCount(current: number, total: number, batch = PROGRESSIVE_BATCH): number {
  return Math.min(total, Math.min(current, total) + batch)
}

/** 先渲染一批，哨兵接近滚动视口底部时追加下一批。 */
export function useProgressiveCount(total: number, scrollRef: RefObject<HTMLElement>, batch = PROGRESSIVE_BATCH) {
  const [count, setCount] = useState(batch)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const visible = Math.min(count, total)
  const hasMore = visible < total

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!hasMore || !sentinel) return
    // 每次追加后重建观察器：首次回调会报告当前状态，哨兵仍在视口内时继续追加。
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setCount(current => nextProgressiveCount(current, total, batch))
    }, { root: scrollRef.current, rootMargin: '0px 0px 600px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [batch, hasMore, scrollRef, total, visible])

  return { visible, hasMore, sentinelRef }
}
