import { useEffect, useId, useRef, useState } from 'react'
import { useMotion } from '../../hooks/useMotion'
import { CloseIcon } from '../ui/CloseIcon'
import styles from './SearchHistory.module.css'

const RECENT_COUNT = 10
const LOAD_STEP = 30

interface SearchHistoryProps {
  terms: string[]
  onSelect(term: string): void
  onRemove(term: string): void
  onClear(): void
}

export function SearchHistory({ terms, onSelect, onRemove, onClear }: SearchHistoryProps) {
  const reducedMotion = !useMotion('smoothScrollMotion')
  const [visibleCount, setVisibleCount] = useState(RECENT_COUNT)
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const collapseRef = useRef<HTMLButtonElement>(null)
  const listHeight = useRef(0)
  const revealMore = useRef(false)
  const restoreMoreFocus = useRef(false)
  const expanded = visibleCount > RECENT_COUNT
  const hasMore = terms.length > visibleCount
  const visibleTerms = terms.slice(0, visibleCount)

  function showMore() {
    revealMore.current = true
    setVisibleCount((count) => Math.min(count + LOAD_STEP, terms.length))
  }

  function collapse() {
    revealMore.current = false
    restoreMoreFocus.current = true
    setVisibleCount(RECENT_COUNT)
  }

  // 列表高度变化时补间，下方热搜随之平滑移动；展开后让操作区留在视口内，便于继续查看。
  useEffect(() => {
    // 操作按钮显隐后把焦点留在仍可见的按钮上，键盘操作不丢位置。
    if (restoreMoreFocus.current) moreRef.current?.focus({ preventScroll: true })
    else if (!hasMore && document.activeElement === moreRef.current) collapseRef.current?.focus({ preventScroll: true })
    restoreMoreFocus.current = false
    const list = listRef.current
    if (!list) return
    const previous = listHeight.current
    const next = list.offsetHeight
    listHeight.current = next
    const reveal = revealMore.current
    revealMore.current = false
    const keepActionsVisible = () => {
      if (reveal) list.nextElementSibling?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' })
    }
    if (!previous || previous === next || reducedMotion) {
      keepActionsVisible()
      return
    }
    const animation = list.animate(
      [{ height: `${previous}px`, overflow: 'hidden' }, { height: `${next}px`, overflow: 'hidden' }],
      { duration: 220, easing: getComputedStyle(list).getPropertyValue('--sm-ease-out') || 'ease-out' },
    )
    animation.onfinish = keepActionsVisible
    return () => animation.cancel()
  }, [visibleCount, hasMore, terms.length, reducedMotion])

  if (!terms.length) return null
  return (
    <section className={styles.section} aria-label="搜索历史">
      <div className={styles.heading}>
        <div className={styles.title}>
          <svg className={styles.headingIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>
          <h2>搜索历史</h2>
        </div>
        <button type="button" className={styles.clear} onClick={onClear}>清空</button>
      </div>
      <div id={listId} ref={listRef} className={styles.terms}>
        {visibleTerms.map(term => (
          <div className={styles.bubble} key={term}>
            <button type="button" className={styles.term} title={term} onClick={() => onSelect(term)}>{term}</button>
            <button type="button" className={styles.remove} title={`删除：${term}`} aria-label={`删除搜索历史：${term}`} onClick={() => onRemove(term)}><CloseIcon size={12} /></button>
          </div>
        ))}
      </div>
      {terms.length > RECENT_COUNT && (
        <div className={styles.footer}>
          <button ref={moreRef} type="button" className={styles.more} data-exhausted={hasMore ? undefined : ''} aria-expanded={expanded} aria-controls={listId} onClick={showMore}>
            <span>查看更多</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {expanded && <button ref={collapseRef} type="button" className={styles.collapse} onClick={collapse}>收起</button>}
        </div>
      )}
    </section>
  )
}
