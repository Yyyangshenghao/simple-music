// src/components/Layout/modules/SearchModule.tsx
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigationStore } from '../../../stores/navigation'
import { useMusicService } from '../../../hooks/useMusicService'
import { usePlaylistStore } from '../../../stores/playlist'
import type { Track, ArtistInfo } from '../../../types/domain'
import { useHoverPanel } from './useHoverPanel'
import styles from './SearchModule.module.css'

export function SearchModule() {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { triggerProps, panelProps } = useHoverPanel(panelRef, { hideDelay: 200 })

  const [keyword, setKeyword] = useState('')
  const [songs, setSongs] = useState<Track[]>([])
  const [artists, setArtists] = useState<ArtistInfo[]>([])
  const [loading, setLoading] = useState(false)

  const service = useMusicService()
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  function handleTriggerEnter() {
    triggerProps.onMouseEnter()
    setTimeout(() => inputRef.current?.focus(), 80)
  }

  async function runSearch() {
    const q = keyword.trim()
    if (!q || loading) return
    setLoading(true)
    try {
      const [s, a] = await Promise.allSettled([
        service.searchTracks(q),
        service.searchArtists(q),
      ])
      setSongs(s.status === 'fulfilled' ? s.value : [])
      setArtists(a.status === 'fulfilled' ? a.value : [])
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void runSearch()
  }

  function pickSong(index: number) {
    usePlaylistStore.getState().setQueue(songs, index)
    setKeyword('')
    setSongs([])
    setArtists([])
  }

  function pickArtist(artist: ArtistInfo) {
    navigateTo({ type: 'artist', id: artist.id, source: artist.source })
    setKeyword('')
    setSongs([])
    setArtists([])
  }

  return (
    <>
      <button
        className={`${styles.seed}`}
        aria-label="搜索"
        onMouseEnter={handleTriggerEnter}
        onMouseLeave={triggerProps.onMouseLeave}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
      </button>
      <div ref={panelRef} className={styles.panel} {...panelProps}>
        <form className={styles.inputRow} onSubmit={handleSubmit}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            className={styles.input}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索歌曲、歌手…"
          />
        </form>
        <div className={styles.results}>
          {loading && <p className={styles.hint}>搜索中…</p>}
          {!loading && artists.length === 0 && songs.length === 0 && keyword.length > 0 && (
            <p className={styles.hint}>无结果</p>
          )}
          {!loading && artists.length > 0 && (
            <div>
              <div className={styles.sectionLabel}>歌手</div>
              {artists.map((a, i) => (
                <button key={`a-${i}`} className={styles.artistRow} onClick={() => pickArtist(a)}>
                  {a.avatar && <img className={styles.avatar} src={a.avatar} alt="" loading="lazy" />}
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && songs.length > 0 && (
            <div>
              {artists.length > 0 && <div className={styles.sectionLabel}>歌曲</div>}
              {songs.slice(0, 8).map((s, i) => (
                <button key={`s-${i}`} className={styles.songRow} onClick={() => pickSong(i)}>
                  {s.cover && <img className={styles.cover} src={s.cover} alt="" loading="lazy" />}
                  <div className={styles.songInfo}>
                    <span className={styles.songName}>{s.name}</span>
                    <span className={styles.songArtist}>{s.artist}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
