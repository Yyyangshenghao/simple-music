// 固定行高虚拟列表:总高度 = rowHeight × total,滚动条从第一刻就是完整长度,
// 可直接拖到任意位置;只渲染可视区 ± overscan 的行,行绝对定位。
// 滚动容器由外部传入(详情页是整页滚动),内部用 rAF 节流计算可视区间。

import { memo, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { virtualRange } from '../../lib/lazy-window'
import { ListScrollActivity, observeListScrollActivity } from './list-scroll-activity'

interface VirtualListProps {
  total: number
  rowHeight: number
  scrollRef: RefObject<HTMLElement | null>
  overscan?: number
  onRangeChange?(start: number, end: number): void
  renderRow(index: number): ReactNode
}

// 滚动只改变可见区间；已有行沿用内容，父级更换数据或回调时仍正常更新。
const VirtualRow = memo(function VirtualRow({ index, rowHeight, renderRow }: {
  index: number
  rowHeight: number
  renderRow: VirtualListProps['renderRow']
}) {
  return (
    <div style={{ position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight }}>
      {renderRow(index)}
    </div>
  )
})

export function VirtualList({ total, rowHeight, scrollRef, overscan = 10, onRangeChange, renderRow }: VirtualListProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const rangeRef = useRef(range)
  const [scrolling, setScrolling] = useState(false)
  const scrollingRef = useRef(false)

  useEffect(() => {
    scrollingRef.current = false
    setScrolling(false)
    const scrollEl = scrollRef.current
    const inner = innerRef.current
    if (!scrollEl || !inner) return
    let raf = 0
    function update() {
      raf = 0
      if (!scrollEl || !inner) return
      // 列表相对滚动内容顶部的偏移(header 占的高度)
      const listTop = inner.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
      const next = virtualRange(scrollEl.scrollTop, scrollEl.clientHeight, listTop, rowHeight, total, overscan)
      if (next.start !== rangeRef.current.start || next.end !== rangeRef.current.end) {
        rangeRef.current = next
        setRange(next)
      }
    }
    function schedule() {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    scrollEl.addEventListener('scroll', schedule, { passive: true })
    const stopActivity = observeListScrollActivity(scrollEl, active => {
      scrollingRef.current = active
      setScrolling(active)
    })
    const ro = new ResizeObserver(schedule)
    ro.observe(scrollEl)
    return () => {
      scrollEl.removeEventListener('scroll', schedule)
      stopActivity()
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollRef, rowHeight, total, overscan])

  useEffect(() => {
    if (!scrollingRef.current && range.end > range.start) onRangeChange?.(range.start, range.end)
  }, [range, onRangeChange, scrolling])

  const rows: ReactNode[] = []
  for (let i = range.start; i < Math.min(range.end, total); i++) {
    rows.push(
      <VirtualRow key={i} index={i} rowHeight={rowHeight} renderRow={renderRow} />
    )
  }
  return (
    <div ref={innerRef} data-list-scrolling={scrolling || undefined} style={{ position: 'relative', height: total * rowHeight }}>
      <ListScrollActivity.Provider value={scrolling}>{rows}</ListScrollActivity.Provider>
    </div>
  )
}
