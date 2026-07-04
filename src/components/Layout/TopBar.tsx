import { useState, useRef, useEffect } from 'react'
import { motion } from 'motion/react'
import { useNavigationStore, type AppView } from '../../stores/navigation'
import { useMusicService } from '../../hooks/useMusicService'
import { usePlaylistStore } from '../../stores/playlist'
import type { Track, ArtistInfo } from '../../types/domain'
import { AvatarMenu } from './AvatarMenu'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import styles from './TopBar.module.css'

const NAV_ITEMS: { label: string; view: AppView }[] = [
  { label: '探索', view: 'explore' },
  { label: '我的库', view: 'library' },
]

interface TopBarProps {
  /** 歌词面板打开时隐藏顶栏 */
  hidden?: boolean
}

export function TopBar({ hidden = false }: TopBarProps) {
  const currentView = useNavigationStore((s) => s.currentView)
  const history = useNavigationStore((s) => s.history)
  const future = useNavigationStore((s) => s.future)
  const navigateTo = useNavigationStore((s) => s.navigateTo)
  const goBack = useNavigationStore((s) => s.goBack)
  const goForward = useNavigationStore((s) => s.goForward)

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
    <div className={`${styles.bar}${hidden ? ` ${styles.barHidden}` : ''}`}>
      {/* Left: traffic lights 留白 + 后退/前进胶囊组 */}
      <div className={styles.left}>
        <div className={styles.navGroup}>
          <motion.button
            className={styles.navBtn}
            onClick={goBack}
            disabled={history.length === 0}
            aria-label="后退"
            whileTap={tapScale}
            transition={springSnappy}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </motion.button>
          <span className={styles.navDivider} aria-hidden="true" />
          <motion.button
            className={styles.navBtn}
            onClick={goForward}
            disabled={future.length === 0}
            aria-label="前进"
            whileTap={tapScale}
            transition={springSnappy}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </motion.button>
        </div>
      </div>

      {/* Center: 滑动胶囊导航（绝对居中） */}
      <div className={styles.center}>
        <nav className={styles.segNav} aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            // 歌单详情归属其来源 tab；其余非「我的库」视图（设置/歌手）默认落在探索
            const section =
              typeof currentView === 'object' && currentView.type === 'playlist'
                ? currentView.from
                : currentView
            const active = section === item.view
              || (item.view === 'explore' && section !== 'library')
            return (
              <button
                key={item.label}
                className={`${styles.segItem}${active ? ` ${styles.segActive}` : ''}`}
                onClick={() => { if (currentView !== item.view) navigateTo(item.view) }}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <motion.span
                    layoutId="topbar-seg-pill"
                    className={styles.segPill}
                    transition={springSnappy}
                  />
                )}
                <span className={styles.segLabel}>{item.label}</span>
              </button>
            )
          })}
        </nav>
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
              width="14"
              height="14"
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
          <motion.button
            className={styles.avatarBtn}
            onClick={() => setAvatarMenuOpen((v) => !v)}
            aria-label="账户菜单"
            whileTap={tapScale}
            transition={springSnappy}
          >
            <span className={styles.avatarInner}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4.5 20.5c1.6-3.4 4.3-5 7.5-5s5.9 1.6 7.5 5" />
              </svg>
            </span>
          </motion.button>
          {avatarMenuOpen && (
            <AvatarMenu onClose={() => setAvatarMenuOpen(false)} />
          )}
        </div>
      </div>
    </div>
  )
}
