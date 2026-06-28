import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api'
import { usePlayerStore } from '../../stores/player'
import { usePlaylistStore } from '../../stores/playlist'
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

/** 搜索框：受控输入 + 搜索按钮（回车触发），内部持有结果并渲染 SearchResults。 */
export function SearchBar() {
  const [keywords, setKeywords] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [searched, setSearched] = useState(false)

  async function runSearch(): Promise<void> {
    const q = keywords.trim()
    if (!q || loading) return
    setLoading(true)
    setError(false)
    setSearched(true)
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

  return (
    <div className={styles.root}>
      <form className={styles.bar} onSubmit={handleSubmit}>
        <input
          className={`${styles.input} no-drag`}
          type="search"
          value={keywords}
          placeholder="搜索歌曲、歌手"
          onChange={(e) => setKeywords(e.target.value)}
        />
        <button className={`${styles.button} no-drag`} type="submit" disabled={loading}>
          {loading ? '搜索中' : '搜索'}
        </button>
      </form>

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
