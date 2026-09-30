import { useState, useRef, useEffect, useMemo } from 'react'
import type { FocusEvent } from 'react'
import { motion } from 'motion/react'
import { useNavigationStore, type AppView } from '../../stores/navigation'
import { usePlaylistStore } from '../../stores/playlist'
import type { Track, ArtistInfo } from '../../types/domain'
import { AvatarMenu } from './AvatarMenu'
import { SearchHotkeys } from '../Search/SearchHotkeys'
import { SourceName } from '../ui/SourceName'
import { providerFor } from '../../providers/registry'
import { isProviderId, PROVIDER_IDS, type ProviderId } from '../../providers/types'
import { useProviderStore } from '../../stores/providers'
import { useContentProvider } from '../../hooks/useContentProvider'
import { runProviderTasks, type ProviderResult } from '../../lib/content-hub'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import styles from './TopBar.module.css'
import { sizedImage } from '../../lib/image-size'

const NAV_ITEMS: { label: string; view: AppView }[] = [
  { label: '探索', view: 'explore' },
  { label: '我的库', view: 'library' },
  { label: '漫游', view: 'roam' },
  { label: '刷歌', view: 'shuange' },
  { label: '设置', view: 'settings' },
]

interface SearchPayload {
  songs: Track[]
  artists: ArtistInfo[]
}

interface TopBarProps {
  /** 歌词面板打开时隐藏顶栏 */
  hidden?: boolean
}

export function TopBar({ hidden = false }: TopBarProps) {
  const { current: contentSource } = useContentProvider()
  const currentView = useNavigationStore((s) => s.currentView)
  const history = useNavigationStore((s) => s.history)
  const future = useNavigationStore((s) => s.future)
  const navigateTo = useNavigationStore((s) => s.navigateTo)
  const goBack = useNavigationStore((s) => s.goBack)
  const goForward = useNavigationStore((s) => s.goForward)

  const [keyword, setKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<Partial<Record<ProviderId, ProviderResult<SearchPayload>>>>({})
  const [searchFocused, setSearchFocused] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedSearchSource, setSelectedSearchSource] = useState<ProviderId | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const searchSeq = useRef(0)
  const enabledSignature = useProviderStore((state) =>
    PROVIDER_IDS.map((source) => state.byId[source].enabled && state.byId[source].auth === 'authenticated' ? '1' : '0').join('')
  )
  const enabledSources = useMemo(
    () => PROVIDER_IDS.filter((_, index) => enabledSignature[index] === '1') as ProviderId[],
    [enabledSignature]
  )
  const activeSearchSource = selectedSearchSource && enabledSources.includes(selectedSearchSource)
    ? selectedSearchSource
    : contentSource && enabledSources.includes(contentSource)
      ? contentSource
      : enabledSources[0] ?? null

  useEffect(() => {
    if (isExpanded) inputRef.current?.focus()
  }, [isExpanded])

  async function runSearch(q: string) {
    if (!q) return
    const seq = ++searchSeq.current
    setSearchResults({})
    await runProviderTasks(
      enabledSources,
      async (source) => {
        const provider = providerFor(source)
        const [songs, artists] = await Promise.all([
          provider.catalog.searchTracks(q),
          provider.catalog.searchArtists(q),
        ])
        return { songs, artists }
      },
      {
        isEnabled: (source) => {
          const state = useProviderStore.getState().byId[source]
          return state.enabled && state.auth === 'authenticated'
        },
        isEmpty: (result) => result.songs.length === 0 && result.artists.length === 0,
        onUpdate: (result) => {
          if (seq !== searchSeq.current) return
          setSearchResults((current) => ({ ...current, [result.source]: result }))
        },
      }
    )
  }

  useEffect(() => {
    // 输入或启用平台变化时立即让上一批请求过期，避免 250ms 防抖窗口内落入旧结果。
    searchSeq.current++
    const q = keyword.trim()
    if (!q) {
      searchSeq.current++
      setSearchResults({})
      return
    }
    const timer = setTimeout(() => { void runSearch(q) }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, enabledSignature])

  function handleSearchClick() {
    if (!isExpanded) setIsExpanded(true)
  }

  function handleSearchBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setSearchFocused(false)
    if (!keyword.trim()) {
      clearSearch()
      setIsExpanded(false)
    }
  }

  function clearSearch() {
    searchSeq.current++
    setKeyword('')
    setSearchResults({})
  }

  function closeSearch() {
    clearSearch()
    setSearchFocused(false)
    setIsExpanded(false)
    inputRef.current?.blur()
  }

  function pickSong(track: Track) {
    if (!isProviderId(track.source)) return
    const songs = searchResults[track.source]?.data?.songs ?? []
    const index = songs.findIndex((item) => item.source === track.source && String(item.id) === String(track.id))
    usePlaylistStore.getState().setQueue(songs, Math.max(index, 0))
    closeSearch()
  }

  function openSearchPage() {
    const query = keyword.trim()
    if (!query) return
    navigateTo({ type: 'search', keyword: query })
    closeSearch()
  }

  function pickArtist(artist: ArtistInfo) {
    if (artist.source === 'local') return
    navigateTo({ type: 'artist', id: artist.id, source: artist.source })
    closeSearch()
  }

  const activeSearchResult = activeSearchSource ? searchResults[activeSearchSource] : undefined
  const activeSearchData = activeSearchResult?.data
  const loading = activeSearchResult?.status === 'loading'
  const hasResults = !!activeSearchData
    && (activeSearchData.songs.length > 0 || activeSearchData.artists.length > 0)
  const showNoResults = enabledSources.length === 0
    || activeSearchResult?.status === 'empty'
    || (activeSearchResult?.status === 'ready' && !hasResults)
  const hotkeySource = contentSource && enabledSources.includes(contentSource)
    && providerFor(contentSource).catalog.getSearchHotkeys ? contentSource : null
  const showHotkeys = keyword.trim() === '' && hotkeySource !== null
  const showDropdown = isExpanded && searchFocused && (showHotkeys || keyword.length > 0 || loading || hasResults)

  const platform = window.desktop?.platform
  const isMac = platform === 'darwin'
  const isWindows = platform === 'win32'

  return (
    <div
      className={`${styles.bar}${currentView === 'shuange' ? ` ${styles.barShuange}` : ''}${hidden ? ` ${styles.barHidden}` : ''}${isMac ? ` ${styles.barMac}` : ''}${isWindows ? ` ${styles.barWin}` : ''}`}
      onDoubleClick={(e) => {
        if (isWindows && e.target === e.currentTarget) void window.desktop.maximize()
      }}
    >
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
            // 歌单详情归属其来源 tab；其余未列入主导航的视图默认落在探索
            const section =
              typeof currentView === 'object' && currentView.type === 'playlist'
                ? currentView.from
                : currentView
            const active = section === item.view
              || (item.view === 'explore' && section !== 'library' && section !== 'roam' && section !== 'shuange' && section !== 'settings')
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
        <div className={styles.searchWrap} onBlur={handleSearchBlur} onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          closeSearch()
        }}>
          <div
            className={`${styles.searchForm} ${isExpanded ? styles.searchExpanded : ''}`}
            onClick={handleSearchClick}
            tabIndex={isExpanded ? -1 : 0}
            role="search"
            aria-label="搜索歌曲、歌手"
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
                aria-label="搜索歌曲、歌手"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault()
                    openSearchPage()
                  }
                }}
                placeholder="搜索歌曲、歌手…"
              />
            ) : (
              <>
                <span className={styles.searchPlaceholder}>搜索歌曲、歌手</span>
                {hotkeySource && <span className={styles.searchHotkeyBadge} aria-label={`${providerFor(hotkeySource).descriptor.label}热搜`}>热搜</span>}
              </>
            )}
          </div>

          {showDropdown && (
            <div className={styles.searchDropdown}>
              {keyword.trim() && (
                <button type="button" className={styles.searchAll} onClick={openSearchPage}>
                  <span>查看聚合搜索结果</span>
                  <span className={styles.searchAllKey} aria-hidden="true">Enter ↵</span>
                </button>
              )}
              {showHotkeys && hotkeySource ? (
                <SearchHotkeys key={hotkeySource} source={hotkeySource} onSelect={(term) => {
                  setKeyword(term)
                  inputRef.current?.focus()
                }} />
              ) : <>
              {keyword.trim().length > 0 && enabledSources.length > 0 && (
                <div className={styles.searchSourceTabs} role="group" aria-label="选择搜索平台">
                  {enabledSources.map((source) => {
                    const descriptor = providerFor(source).descriptor
                    const active = source === activeSearchSource
                    return (
                      <button
                        key={source}
                        type="button"
                        className={`${styles.searchSourceTab}${active ? ` ${styles.searchSourceTabActive}` : ''}`}
                        style={{ '--provider-color': descriptor.color } as React.CSSProperties}
                        aria-pressed={active}
                        onClick={() => setSelectedSearchSource(source)}
                      >
                        <span className={styles.searchSourceMark} aria-hidden="true" />
                        <span><SourceName source={source} /></span>
                      </button>
                    )
                  })}
                </div>
              )}
              {loading && <p className={styles.searchHint}>搜索中…</p>}
              {showNoResults && keyword.length > 0 && (
                <p className={styles.searchHint}>{enabledSources.length === 0 ? '请先启用音乐平台' : '无结果'}</p>
              )}
              {activeSearchSource && activeSearchResult?.status === 'error' && (
                <p className={styles.providerError}>{activeSearchResult.error?.message}</p>
              )}
              {activeSearchSource && activeSearchData && activeSearchResult?.status !== 'empty' && (
                <div className={styles.searchProvider}>
                    {activeSearchData.artists.length > 0 && (
                      <div>
                        <div className={styles.searchSection}>歌手</div>
                        {activeSearchData.artists.slice(0, 4).map((artist) => (
                          <button key={`${artist.source}:${String(artist.id)}`} className={styles.artistRow} onClick={() => pickArtist(artist)}>
                            {artist.avatar && <img className={styles.rowAvatar} src={sizedImage(artist.avatar, 88)} alt="" loading="lazy" />}
                            <span>{artist.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {activeSearchData.songs.length > 0 && (
                      <div>
                        <div className={styles.searchSection}>歌曲</div>
                        {activeSearchData.songs.slice(0, 6).map((song) => (
                          <button key={`${song.source}:${String(song.id)}`} className={styles.songRow} onClick={() => pickSong(song)}>
                            {song.cover && <img className={styles.rowCover} src={sizedImage(song.cover, 88)} alt="" loading="lazy" />}
                            <div className={styles.songInfo}>
                              <span className={styles.songName}>{song.name}</span>
                              <span className={styles.songArtist}>{song.artist}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                </div>
              )}
              </>}
            </div>
          )}
        </div>

        <div className={styles.avatarWrap}>
          <motion.button
            className={styles.avatarBtn}
            onClick={() => setAvatarMenuOpen((v) => !v)}
            aria-label={`音源与账号，已启用 ${enabledSources.length} 个平台`}
            whileTap={tapScale}
            transition={springSnappy}
          >
            <span className={styles.avatarInner}>
              <svg className={styles.accountGlyph} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
