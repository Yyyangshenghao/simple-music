import { useState, useRef, useEffect, useCallback } from 'react'
import type { FormEvent } from 'react'
import { gsap } from 'gsap'
import { useNavigationStore } from '../../stores/navigation'
import { useMusicService } from '../../hooks/useMusicService'
import { usePlaylistStore } from '../../stores/playlist'
import type { Track, ArtistInfo } from '../../types/domain'
import styles from './SearchPill.module.css'

export function SearchPill() {
  const [expanded, setExpanded] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [songs, setSongs] = useState<Track[]>([])
  const [artists, setArtists] = useState<ArtistInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)

  const pillRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const service = useMusicService()
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  const expand = useCallback(() => {
    setExpanded(true)
    gsap.fromTo(pillRef.current, { width: 36 }, { width: 240, duration: 0.3, ease: 'power2.out' })
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const collapse = useCallback(() => {
    gsap.to(pillRef.current, {
      width: 36, duration: 0.25, ease: 'power2.in',
      onComplete: () => { setExpanded(false); setKeyword(''); setSongs([]); setArtists([]); setDropOpen(false) },
    })
  }, [])

  useEffect(() => {
    return () => { gsap.killTweensOf(pillRef.current) }
  }, [])

  useEffect(() => {
    if (!dropOpen) return
    const handler = (e: MouseEvent) => {
      if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
        setDropOpen(false)
      }
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDropOpen(false); collapse() } }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc) }
  }, [dropOpen, collapse])

  async function runSearch() {
    const q = keyword.trim()
    if (!q || loading) return
    setLoading(true)
    setDropOpen(true)
    try {
      const [foundSongs, foundArtists] = await Promise.allSettled([
        service.searchTracks(q),
        service.searchArtists(q),
      ])
      setSongs(foundSongs.status === 'fulfilled' ? foundSongs.value : [])
      setArtists(foundArtists.status === 'fulfilled' ? foundArtists.value : [])
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
    collapse()
  }

  function pickArtist(artist: ArtistInfo) {
    navigateTo({ type: 'artist', id: artist.id, source: artist.source })
    collapse()
  }

  return (
    <div className={styles.wrapper} ref={pillRef}>
      {!expanded ? (
        <button className={`${styles.icon} no-drag`} onClick={expand} aria-label="搜索">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </button>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className={`${styles.input} no-drag`}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索歌曲、歌手…"
          />
          <button type="button" className={`${styles.closeBtn} no-drag`} onClick={collapse} aria-label="关闭">✕</button>
        </form>
      )}

      {dropOpen && (songs.length > 0 || artists.length > 0 || loading) && (
        <div className={styles.dropdown}>
          {loading && <p className={styles.hint}>搜索中…</p>}
          {!loading && artists.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>歌手</div>
              {artists.map((a, i) => (
                <button key={`a-${i}`} className={`${styles.artistRow} no-drag`} onClick={() => pickArtist(a)}>
                  {a.avatar && <img className={styles.avatar} src={a.avatar} alt="" loading="lazy" />}
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && songs.length > 0 && (
            <div className={styles.section}>
              {artists.length > 0 && <div className={styles.sectionLabel}>歌曲</div>}
              {songs.slice(0, 8).map((s, i) => (
                <button key={`s-${i}`} className={`${styles.songRow} no-drag`} onClick={() => pickSong(i)}>
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
      )}
    </div>
  )
}
