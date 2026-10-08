import { useEffect, useId, useRef, useState } from 'react'
import styles from './SearchHistory.module.css'

const RECENT_COUNT = 10

interface SearchHistoryProps {
  terms: string[]
  onSelect(term: string): void
  onRemove(term: string): void
  onClear(): void
}

export function SearchHistory({ terms, onSelect, onRemove, onClear }: SearchHistoryProps) {
  const [visibleCount, setVisibleCount] = useState(RECENT_COUNT)
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const pendingReveal = useRef<number | null>(null)
  const expanded = visibleCount > RECENT_COUNT
  const hasMore = terms.length > visibleCount
  const visibleTerms = terms.slice(0, visibleCount)

  function showMore() {
    pendingReveal.current = visibleTerms.length
    setVisibleCount((count) => Math.min(count + RECENT_COUNT, terms.length))
  }

  function collapse() {
    moreRef.current?.focus()
    setVisibleCount(RECENT_COUNT)
    pendingReveal.current = null
  }

  useEffect(() => {
    const index = pendingReveal.current
    pendingReveal.current = null
    const list = listRef.current
    if (visibleCount === RECENT_COUNT) {
      list?.scrollTo({ top: 0, behavior: 'instant' })
      return
    }
    const firstNew = index === null ? null : list?.children.item(index)
    if (!list || !(firstNew instanceof HTMLElement)) return
    // 新一批从视口中部接入，保留上方旧记录作为衔接。
    const top = firstNew.offsetTop - list.clientHeight / 2
    list.scrollTo({
      top: Math.max(list.scrollTop, top),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }, [visibleCount])

  if (!terms.length) return null
  return (
    <section className={`${styles.section}${expanded ? ` ${styles.sectionExpanded}` : ''}`} aria-label="搜索历史">
      <div className={styles.heading}>
        <div className={styles.title}>
          <svg className={styles.headingIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>
          <h3>搜索历史</h3>
        </div>
        <button type="button" className={styles.clear} onClick={onClear}>清空</button>
      </div>
      <div id={listId} ref={listRef} className={styles.terms}>
        {visibleTerms.map((term, index) => (
          <div className={`${styles.bubble}${index >= RECENT_COUNT ? ` ${styles.bubbleReveal}` : ''}`} style={index >= RECENT_COUNT ? { animationDelay: `${180 + ((index - RECENT_COUNT) % RECENT_COUNT) * 36}ms` } : undefined} key={term}>
            <button type="button" className={styles.term} title={term} onClick={() => onSelect(term)}>{term}</button>
            <button type="button" className={styles.remove} title={`删除：${term}`} aria-label={`删除搜索历史：${term}`} onClick={() => onRemove(term)}>×</button>
          </div>
        ))}
      </div>
      {terms.length > RECENT_COUNT && (
        <div className={styles.footer}>
          <button ref={moreRef} type="button" className={styles.more} aria-expanded={expanded} aria-controls={listId} onClick={hasMore ? showMore : collapse}>
            <span>{hasMore ? '查看更多' : '收起历史'}</span>
            <svg className={hasMore ? styles.chevron : styles.chevronUp} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>
          {expanded && hasMore && <button type="button" className={styles.collapse} onClick={collapse}>收起</button>}
        </div>
      )}
    </section>
  )
}
