import { useEffect, useState } from 'react'
import { providerFor } from '../../providers/registry'
import type { ProviderId } from '../../providers/types'
import { SourceName } from '../ui/SourceName'
import styles from './SearchHotkeys.module.css'

interface SearchHotkeysProps {
  source: ProviderId
  onSelect: (keyword: string) => void
}

/** 仅在空搜索展开时挂载，关闭或切换来源后丢弃迟到响应。 */
export function SearchHotkeys({ source, onSelect }: SearchHotkeysProps) {
  const [keywords, setKeywords] = useState<string[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const provider = providerFor(source)

  useEffect(() => {
    let cancelled = false
    setKeywords([])
    setStatus('loading')
    const request = provider.catalog.getSearchHotkeys
    if (!request) {
      setStatus('ready')
      return
    }
    void request().then((terms) => {
      if (cancelled) return
      setKeywords(terms)
      setStatus('ready')
    }).catch(() => {
      if (!cancelled) setStatus('error')
    })
    return () => { cancelled = true }
  }, [provider])

  return (
    <section className={styles.section} aria-label={`${provider.descriptor.label}热搜`}>
      <h3 className={styles.heading}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 16 6-6 4 4 8-9M15 5h6v6" /></svg>
        <span><SourceName source={source} />热搜</span>
      </h3>
      {status === 'loading' ? <p className={styles.hint} role="status">热词加载中…</p>
        : status === 'error' ? <p className={styles.hint}>热词暂不可用，可直接输入搜索</p>
          : keywords.length === 0 ? <p className={styles.hint}>暂无热词，可直接输入搜索</p>
            : <div className={styles.keywords}>
                {keywords.map((keyword, index) => (
                  <button
                    key={keyword}
                    type="button"
                    className={styles.keyword}
                    title={keyword}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSelect(keyword)}
                  >
                    <span className={styles.rank} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <span className={styles.term}>{keyword}</span>
                    <svg className={styles.arrow} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg>
                  </button>
                ))}
              </div>}
    </section>
  )
}
