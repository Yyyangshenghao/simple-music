import { useState, useRef, useEffect } from 'react'
import { useNavigationStore } from '../../stores/navigation'
import { useMusicService } from '../../hooks/useMusicService'
import { usePlaylistStore } from '../../stores/playlist'
import type { Track, ArtistInfo } from '../../types/domain'
import { AvatarMenu } from './AvatarMenu'
import GooeyNav from './GooeyNav'
import styles from './TopBar.module.css'

export function TopBar() {
  const currentView = useNavigationStore((s) => s.currentView)
  const history = useNavigationStore((s) => s.history)
  const navigateTo = useNavigationStore((s) => s.navigateTo)
  const goBack = useNavigationStore((s) => s.goBack)

  const [keyword, setKeyword] = useState('')
  const [songs, setSongs] = useState<Track[]>([])
  const [artists, setArtists] = useState<ArtistInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const service = useMusicService()

  useEffect(() => {
    if (isExpanded) inputRef.current?.focus()
  }, [isExpanded])

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

  function handleSearchClick() {
    if (!isExpanded) setIsExpanded(true)
  }

  function handleSearchBlur() {
    setTimeout(() => {
      setSearchFocused(false)
      if (!keyword) {
        clearSearch()
        setIsExpanded(false)
      }
    }, 150)
  }

  function clearSearch() {
    setKeyword('')
    setSongs([])
    setArtists([])
  }

  function pickSong(index: number) {
    usePlaylistStore.getState().setQueue(songs, index)
    clearSearch()
    inputRef.current?.blur()
  }

  function pickArtist(artist: ArtistInfo) {
    navigateTo({ type: 'artist', id: artist.id, source: artist.source })
    clearSearch()
    inputRef.current?.blur()
  }

  const hasResults = songs.length > 0 || artists.length > 0
  const showDropdown = isExpanded && searchFocused && (keyword.length > 0 || loading || hasResults)

  return (
    <div className={styles.bar}>
      {/* Left: traffic lights 留白 + 后退按钮 */}
      <div className={styles.left}>
        <button
          className={styles.backBtn}
          onClick={goBack}
          disabled={history.length === 0}
          aria-label="后退"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* Center: GooeyNav（绝对居中） */}
      <div className={styles.center}>
        <GooeyNav
          items={[
            { label: '探索', href: '#' },
            { label: '我的库', href: '#' },
          ]}
          activeIndex={currentView === 'library' ? 1 : 0}
          onSelect={(i) => navigateTo(i === 0 ? 'explore' : 'library')}
          particleCount={12}
          colors={[1, 1, 2, 1, 2, 1]}
        />
      </div>

      {/* Right: 搜索框 + 头像 */}
      <div className={styles.right}>
        <div className={styles.searchWrap}>
          <div
            className={`${styles.searchForm} ${isExpanded ? styles.searchExpanded : ''}`}
            onClick={handleSearchClick}
            tabIndex={isExpanded ? -1 : 0}
            role="search"
            onKeyDown={(e) => {
              if (!isExpanded && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                handleSearchClick()
              }
            }}
          >
            <svg
              className={styles.searchIcon}
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            {isExpanded ? (
              <input
                ref={inputRef}
                className={styles.searchInput}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={handleSearchBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void runSearch() }
                }}
                placeholder="搜索歌曲、歌手…"
              />
            ) : (
              <span className={styles.searchPlaceholder}>搜索…</span>
            )}
          </div>

          {showDropdown && (
            <div className={styles.searchDropdown}>
              {loading && <p className={styles.searchHint}>搜索中…</p>}
              {!loading && keyword.length > 0 && !hasResults && (
                <p className={styles.searchHint}>无结果</p>
              )}
              {!loading && artists.length > 0 && (
                <div>
                  <div className={styles.searchSection}>歌手</div>
                  {artists.map((a, i) => (
                    <button key={`a-${i}`} className={styles.artistRow} onMouseDown={() => pickArtist(a)}>
                      {a.avatar && <img className={styles.rowAvatar} src={a.avatar} alt="" loading="lazy" />}
                      <span>{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {!loading && songs.length > 0 && (
                <div>
                  {artists.length > 0 && <div className={styles.searchSection}>歌曲</div>}
                  {songs.slice(0, 8).map((s, i) => (
                    <button key={`s-${i}`} className={styles.songRow} onMouseDown={() => pickSong(i)}>
                      {s.cover && <img className={styles.rowCover} src={s.cover} alt="" loading="lazy" />}
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

        <div className={styles.avatarWrap}>
          <button
            className={styles.avatarBtn}
            onClick={() => setAvatarMenuOpen((v) => !v)}
            aria-label="账户菜单"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z" />
            </svg>
          </button>
          {avatarMenuOpen && (
            <AvatarMenu onClose={() => setAvatarMenuOpen(false)} />
          )}
        </div>
      </div>
    </div>
  )
}
