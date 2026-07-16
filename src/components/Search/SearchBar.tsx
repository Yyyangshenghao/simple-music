import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api'
import { usePlayerStore } from '../../stores/player'
import { usePlaylistStore } from '../../stores/playlist'
import {
  loadSearchHistory,
  saveSearchHistory,
  pushTerm,
  removeTerm,
} from '../../lib/search-history'
import { GlassPanel } from '../ui/GlassPanel'
import type { Track } from '../../types/domain'
import { SearchResults } from './SearchResults'
import styles from './SearchBar.module.css'

interface SearchResponse {
  songs: Track[]
}

/** netease/qq 端点与 limit 选择，依据 player.source。 */
function endpoint(source: 'netease' | 'qq'): { path: string; limit: number } {
  return source === 'qq'
    ? { path: '/api/qq/search', limit: 12 }
    : { path: '/api/search', limit: 20 }
}

/** 搜索框：受控输入 + 搜索按钮（回车触发），内部持有结果并渲染 SearchResults；
 * 聚焦且输入为空时下拉展示搜索历史（localStorage 持久化,可单条删除/清空）。 */
export function SearchBar() {
  const [keywords, setKeywords] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [searched, setSearched] = useState(false)
  const [focused, setFocused] = useState(false)
  const [history, setHistory] = useState<string[]>(loadSearchHistory)

  function updateHistory(next: string[]): void {
    setHistory(next)
    saveSearchHistory(next)
  }

  async function runSearch(term?: string): Promise<void> {
    const q = (term ?? keywords).trim()
    if (!q || loading) return
    setLoading(true)
    setError(false)
    setSearched(true)
    updateHistory(pushTerm(history, q))
    const source = usePlayerStore.getState().source
    const { path, limit } = endpoint(source)
    try {
      const res = await api.get<SearchResponse>(path, { keywords: q, limit })
      setResults(res.songs ?? [])
    } catch {
      setError(true)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault()
    void runSearch()
  }

  function handlePick(index: number): void {
    usePlaylistStore.getState().setQueue(results, index)
  }

  function pickHistory(term: string): void {
    setKeywords(term)
    void runSearch(term)
  }

  // 聚焦 + 输入为空 + 有历史时显示历史下拉;搜过之后优先展示结果面板
  const showHistory = focused && keywords.trim() === '' && history.length > 0 && !searched

  return (
    <div className={styles.root}>
      <form className={styles.bar} onSubmit={handleSubmit}>
        <input
          className={`${styles.input} no-drag`}
          type="search"
          value={keywords}
          placeholder="搜索歌曲、歌手"
          onChange={(e) => {
            setKeywords(e.target.value)
            // 清空输入即收起结果面板,让历史下拉可再次出现
            if (e.target.value === '') {
              setSearched(false)
              setResults([])
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <button className={`${styles.button} no-drag`} type="submit" disabled={loading}>
          {loading ? '搜索中' : '搜索'}
        </button>
      </form>

      {showHistory && (
        /* pointerdown preventDefault:点历史项时不让输入框失焦,焦点留在搜索流程里 */
        <div onPointerDown={(e) => e.preventDefault()}>
          <GlassPanel className={styles.panel}>
          <div className={styles.historyHeader}>
            <span>搜索历史</span>
            <button type="button" className={`${styles.historyClear} no-drag`} onClick={() => updateHistory([])}>
              清空
            </button>
          </div>
          <div className={styles.historyList}>
            {history.map((term) => (
              <div key={term} className={styles.historyRow}>
                <button type="button" className={`${styles.historyTerm} no-drag`} onClick={() => pickHistory(term)}>
                  {term}
                </button>
                <button
                  type="button"
                  className={`${styles.historyRemove} no-drag`}
                  aria-label={`删除历史:${term}`}
                  onClick={() => updateHistory(removeTerm(history, term))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          </GlassPanel>
        </div>
      )}

      {searched && (
        <GlassPanel className={styles.panel}>
          {loading ? (
            <p className={styles.hint}>搜索中…</p>
          ) : error ? (
            <p className={styles.hint}>搜索失败，请重试</p>
          ) : results.length === 0 ? (
            <p className={styles.hint}>没有找到相关结果</p>
          ) : (
            <SearchResults results={results} onPick={handlePick} />
          )}
        </GlassPanel>
      )}
    </div>
  )
}
