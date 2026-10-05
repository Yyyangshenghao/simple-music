import styles from './SearchHistory.module.css'

interface SearchHistoryProps {
  terms: string[]
  onSelect(term: string): void
  onRemove(term: string): void
  onClear(): void
}

export function SearchHistory({ terms, onSelect, onRemove, onClear }: SearchHistoryProps) {
  if (!terms.length) return null
  return (
    <section className={styles.section} aria-label="搜索历史">
      <div className={styles.heading}>
        <h3>搜索历史</h3>
        <button type="button" onClick={onClear}>清空</button>
      </div>
      {terms.map((term) => (
        <div className={styles.row} key={term}>
          <button type="button" className={styles.term} title={term} onClick={() => onSelect(term)}>{term}</button>
          <button type="button" className={styles.remove} aria-label={`删除搜索历史：${term}`} onClick={() => onRemove(term)}>×</button>
        </div>
      ))}
    </section>
  )
}
