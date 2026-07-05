// 固定行高虚拟列表:总高度 = rowHeight × total,滚动条从第一刻就是完整长度,
// 可直接拖到任意位置;只渲染可视区 ± overscan 的行,行绝对定位。
// 滚动容器由外部传入(详情页是整页滚动),内部用 rAF 节流计算可视区间。

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { virtualRange } from '../../lib/lazy-window'

interface VirtualListProps {
  total: number
  rowHeight: number
  scrollRef: RefObject<HTMLElement | null>
  overscan?: number
  onRangeChange?(start: number, end: number): void
  renderRow(index: number): ReactNode
}

export function VirtualList({ total, rowHeight, scrollRef, overscan = 10, onRangeChange, renderRow }: VirtualListProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const rangeRef = useRef(range)

  useEffect(() => {
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
    const ro = new ResizeObserver(schedule)
    ro.observe(scrollEl)
    return () => {
      scrollEl.removeEventListener('scroll', schedule)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollRef, rowHeight, total, overscan])

  useEffect(() => {
    if (range.end > range.start) onRangeChange?.(range.start, range.end)
  }, [range, onRangeChange])

  const rows: ReactNode[] = []
  for (let i = range.start; i < range.end; i++) {
    rows.push(
      <div key={i} style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}>
        {renderRow(i)}
      </div>
    )
  }
  return (
    <div ref={innerRef} style={{ position: 'relative', height: total * rowHeight }}>
      {rows}
    </div>
  )
}
