import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { bilibiliLinkMessage, parseBilibiliLink } from '../../lib/bilibili-link'
import { providerAccountSession } from '../../lib/provider-account-session'
import { loadSearchHistory, pushTerm, removeTerm, saveSearchHistory } from '../../lib/search-history'
import { providerFor } from '../../providers/registry'
import { PROVIDER_IDS } from '../../providers/types'
import { useNavigationStore } from '../../stores/navigation'
import { useProviderStore } from '../../stores/providers'
import { CloseIcon } from '../ui/CloseIcon'
import { SearchHistory } from './SearchHistory'
import { SearchHotkeys } from './SearchHotkeys'
import styles from './SearchForm.module.css'

/** 头部固定在滚动区外，历史与热搜经 children 交给页面放进滚动内容。 */
export function SearchForm({ keyword, focusInput, busy, onRefresh, children }: {
  keyword: string
  focusInput?: boolean
  busy: boolean
  onRefresh(): void
  children(suggestions: ReactNode): ReactNode
}) {
  const errorId = useId()
  const [draft, setDraft] = useState(keyword)
  const [history, setHistory] = useState(loadSearchHistory)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const navigateTo = useNavigationStore(state => state.navigateTo)
  const byId = useProviderStore(state => state.byId)
  const hotkeySources = keyword ? [] : PROVIDER_IDS.filter(source => byId[source].enabled && providerFor(source).catalog.getSearchHotkeys)
  const multipleHotkeys = hotkeySources.length > 1
  const pending = busy && draft.trim() === keyword

  useEffect(() => {
    if (focusInput) {
      input.current?.focus({ preventScroll: true })
      if (keyword) input.current?.select()
    }
  }, [focusInput, keyword])

  function updateHistory(next: string[]) {
    saveSearchHistory(next)
    setHistory(next)
  }

  function submit(term: string) {
    const query = term.trim()
    if (!query || (busy && query === keyword)) return
    const link = parseBilibiliLink(query)
    if (link?.kind === 'unsupported') {
      setDraft(term)
      setError(bilibiliLinkMessage(link.reason))
      input.current?.focus({ preventScroll: true })
      return
    }
    updateHistory(pushTerm(loadSearchHistory(), link?.bvid ?? query))
    if (link) {
      navigateTo({ type: 'bilibili-video', bvid: link.bvid })
    } else if (query !== keyword) {
      navigateTo({ type: 'search', keyword: query })
    } else {
      setDraft(query)
      onRefresh()
    }
  }

  function clear() {
    setError('')
    if (keyword) navigateTo({ type: 'search', keyword: '', focusInput: true })
    else {
      setDraft('')
      input.current?.focus({ preventScroll: true })
    }
  }

  return <>
    <header className={styles.pinned} data-home={!keyword}>
      <h1>搜索</h1>
      <form className={styles.form} role="search" aria-label="音乐搜索" onSubmit={event => {
        event.preventDefault()
        if (!composing.current) submit(draft)
      }}>
        <svg className={styles.glyph} width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7.5" /><path d="m20.5 20.5-4.2-4.2" />
        </svg>
        <input ref={input} value={draft} type="text" aria-label="搜索音乐" aria-invalid={!!error || undefined} aria-describedby={error ? errorId : undefined}
          placeholder="歌曲、歌手、专辑、歌单或 B 站视频链接"
          onChange={event => { setDraft(event.target.value); setError('') }}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault()
          }} />
        {(draft || keyword) && <button type="button" className={styles.clear} aria-label="清除搜索" data-tip="清除搜索" onClick={clear}><CloseIcon size={16} /></button>}
        <button type="submit" className={styles.submit} disabled={!draft.trim() || pending} aria-busy={pending || undefined}>{pending ? '搜索中…' : '搜索'}</button>
      </form>
      {error && <p className={styles.error} id={errorId} role="alert">{error}</p>}
      {keyword && draft.trim() !== keyword && <p className={styles.current}>当前结果 · {keyword}</p>}
    </header>
    {children(!keyword && (history.length > 0 || hotkeySources.length > 0) && <div className={styles.suggestions} data-multi-hotkeys={multipleHotkeys || undefined}>
      <SearchHistory terms={history} onSelect={submit} onRemove={term => updateHistory(removeTerm(history, term))} onClear={() => updateHistory([])} />
      {hotkeySources.length > 0 && <div className={styles.hotkeys}>
        {hotkeySources.map(source => <SearchHotkeys key={`${source}:${providerAccountSession(source)}`} source={source} onSelect={submit} />)}
      </div>}
    </div>)}
  </>
}
