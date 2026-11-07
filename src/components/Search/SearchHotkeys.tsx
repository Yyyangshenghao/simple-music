import { useEffect, useState } from 'react'
import { providerFor } from '../../providers/registry'
import type { ProviderId } from '../../providers/types'
import { SourceBadge } from '../ui/SourceBadge'
import { SourceName } from '../ui/SourceName'
import styles from './SearchHotkeys.module.css'

interface SearchHotkeysProps {
  source: ProviderId
  onSelect: (keyword: string) => void
}

/** 仅在搜索首页挂载，离开页面或切换来源后丢弃迟到响应。 */
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
      <h2 className={styles.heading}>
        <span className={styles.sourceIcon} aria-hidden="true"><SourceBadge source={source} compact reveal showInactive /></span>
        <span><SourceName source={source} />热搜</span>
      </h2>
      {status === 'loading' ? <p className={styles.hint} role="status">正在加载热搜…</p>
        : status === 'error' ? <p className={styles.hint}>热搜暂不可用</p>
          : keywords.length === 0 ? <p className={styles.hint}>暂无热搜</p>
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
