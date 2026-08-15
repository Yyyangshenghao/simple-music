import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'
import { todayKey, useRoamStore, type RoamPlaylist } from '../stores/roam'
import { serviceFor } from '../lib/service-registry'
import { PROVIDER_IDS, type ProviderId } from '../providers/types'
import { ArtistPickerOverlay } from '../components/Roam/ArtistPickerOverlay'
import { ArtistLibrarySection } from '../components/Roam/ArtistLibrarySection'
import { TrackRow } from '../components/Explore/TrackRow'
import { Toggle } from '../components/ui/Toggle'
import { GradientText } from '../components/ui/GradientText'
import { SourceBadge } from '../components/ui/SourceBadge'
import { fadeRise, springGentle, springSnappy, tapScale } from '../lib/motion-presets'
import styles from './RoamPage.module.css'

type SavedPlaylistSlot = 'netease' | 'local'

interface SavedPlaylistCandidate {
  slot: SavedPlaylistSlot
  playlist: RoamPlaylist
}

export function mergeSavedPlaylist(
  saved: SavedPlaylistCandidate[],
  playlist: RoamPlaylist,
  slot: SavedPlaylistSlot
): SavedPlaylistCandidate[] {
  return [...saved.filter((item) => item.slot !== slot), { slot, playlist }]
}

function playlistSources(playlist: RoamPlaylist): ProviderId[] {
  return playlist.source === 'mixed'
    ? PROVIDER_IDS.filter((source) => playlist.tracks.some((track) => track.source === source))
    : [playlist.source]
}

function playlistIsAvailable(playlist: RoamPlaylist, enabledSources: ProviderId[]): boolean {
  return playlist.tracks.every((track) =>
    !PROVIDER_IDS.includes(track.source as ProviderId) || enabledSources.includes(track.source as ProviderId)
  )
}

export function RoamPage() {
  const enabledSignature = useProviderStore((state) =>
    PROVIDER_IDS.map((source) => state.byId[source].enabled && state.byId[source].auth === 'authenticated' ? '1' : '0').join('')
  )
  const enabledSources = useMemo(
    () => PROVIDER_IDS.filter((_, index) => enabledSignature[index] === '1') as ProviderId[],
    [enabledSignature]
  )
  const playlist = useRoamStore((s) => s.playlist)
  const localPlaylist = useRoamStore((s) => s.localPlaylist)
  const entries = useRoamStore((s) => s.entries)
  const mode = useRoamStore((s) => s.mode)
  const scope = useRoamStore((s) => s.scope)
  const generating = useRoamStore((s) => s.generating)
  const confirmArtists = useRoamStore((s) => s.confirmArtists)
  const setMode = useRoamStore((s) => s.setMode)
  const setScope = useRoamStore((s) => s.setScope)
  const generate = useRoamStore((s) => s.generate)
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const loading = useRoamStore((s) => s.loading)
  const error = useRoamStore((s) => s.error)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [openedPlaylist, setOpenedPlaylist] = useState<RoamPlaylist | null>(null)
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylistCandidate[]>(() => {
    const saved = localPlaylist ? mergeSavedPlaylist([], localPlaylist, 'local') : []
    if (!playlist) return saved
    return mergeSavedPlaylist(saved, playlist, playlist === localPlaylist ? 'local' : 'netease')
  })

  const { topOpacity, bottomOpacity, handleScroll } = useScrollGradient()
  const scopeSources = scope === 'all' ? enabledSources : enabledSources.filter((source) => source === scope)
  const hasInactiveEntries = entries.some((entry) =>
    entry.artist.source !== 'local' && !enabledSources.includes(entry.artist.source)
  )
  const availableSavedPlaylists = savedPlaylists.filter((item) =>
    playlistIsAvailable(item.playlist, enabledSources)
  )

  const totalTracks = entries.reduce((n, e) => n + e.tracks.length, 0)
  const anyLoading = entries.some((e) => e.loading)

  useEffect(() => {
    if (!playlist) return
    const slot = playlist === localPlaylist ? 'local' : 'netease'
    setSavedPlaylists((saved) => mergeSavedPlaylist(saved, playlist, slot))
  }, [localPlaylist, playlist])

  useEffect(() => {
    if (localPlaylist) setSavedPlaylists((saved) => mergeSavedPlaylist(saved, localPlaylist, 'local'))
  }, [localPlaylist])

  useEffect(() => {
    if (scope !== 'all' && !enabledSources.includes(scope)) setScope('all')
    else if (hasInactiveEntries) setScope('all')
    if (openedPlaylist && !playlistIsAvailable(openedPlaylist, enabledSources)) setOpenedPlaylist(null)
  }, [enabledSources, hasInactiveEntries, openedPlaylist, scope, setScope])

  useEffect(() => {
    useRoamStore.getState().clearSuggestions()
    setPickerOpen(false)
  }, [enabledSignature])

  // 网易云远端存档与本地混合/QQ 存档并列展示，不依赖当前候选范围，也不自动进入结果态。
  useEffect(() => {
    if (!neteaseLoggedIn || !enabledSources.includes('netease')) return
    void useRoamStore.getState().ensureNeteaseHydrated(serviceFor('netease'))
  }, [enabledSources, neteaseLoggedIn, scope])

  function playAt(index: number) {
    if (!openedPlaylist) return
    usePlaylistStore.getState().setQueue(openedPlaylist.tracks, index)
  }

  function handleConfirmArtists(artists: Parameters<typeof confirmArtists>[0]) {
    confirmArtists(artists)
    setPickerOpen(false)
    setDrafting(true)
  }

  function handleRegenerate(savedPlaylist: RoamPlaylist) {
    const nextScope = savedPlaylist.source === 'mixed'
      ? 'all'
      : savedPlaylist.source
    setScope(nextScope)
    setOpenedPlaylist(null)
    setDrafting(true)
    if (nextScope === 'all' ? enabledSources.length > 0 : enabledSources.includes(nextScope)) {
      setPickerOpen(true)
    }
  }

  async function handleGenerate() {
    const previous = useRoamStore.getState().playlist
    await generate()
    const state = useRoamStore.getState()
    const generated = state.playlist
    if (!generated || generated === previous || state.error || state.entries.length > 0) return
    const slot = generated === state.localPlaylist ? 'local' : 'netease'
    setSavedPlaylists((saved) => mergeSavedPlaylist(saved, generated, slot))
    setOpenedPlaylist(generated)
    setDrafting(false)
  }

  if (openedPlaylist) {
    return (
      <div className={styles.page} onScroll={handleScroll}>
        <div className="topGradient" style={{ opacity: topOpacity }} />
        <div className={styles.inner}>
          <motion.div
            className={styles.resultHeader}
            variants={fadeRise}
            initial="hidden"
            animate="visible"
            transition={springGentle}
          >
            <div>
              <h1 className={styles.title}>
                <GradientText>{openedPlaylist.date === todayKey() ? '今日漫游' : '上次漫游'}</GradientText>
              </h1>
              <p className={styles.subtitle}>
                {openedPlaylist.date === todayKey() ? null : `${openedPlaylist.date} · `}
                {openedPlaylist.artists.length} 位歌手 · {openedPlaylist.tracks.length} 首
              </p>
              <div className={styles.resultSources}>
                {playlistSources(openedPlaylist).map((source) => <SourceBadge key={source} source={source} reveal />)}
                <span>{openedPlaylist.source === 'netease' && neteaseLoggedIn ? '已同步平台歌单' : '保存在本地'}</span>
              </div>
            </div>
            <div className={styles.resultActions}>
              <motion.button
                className={`${styles.backBtn} no-drag`}
                onClick={() => setOpenedPlaylist(null)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                <svg
                  className={styles.backIcon}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                <span>返回</span>
              </motion.button>
              <motion.button
                className={`${styles.resetBtn} no-drag`}
                onClick={() => handleRegenerate(openedPlaylist)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                重新选择
              </motion.button>
            </div>
          </motion.div>
          <motion.div
            className={styles.trackList}
            variants={fadeRise}
            initial="hidden"
            animate="visible"
            transition={{ ...springGentle, delay: 0.08 }}
          >
            {openedPlaylist.tracks.map((track, i) => (
              <TrackRow key={`${track.source}-${String(track.id)}`} track={track} index={i} onPlay={() => playAt(i)} />
            ))}
          </motion.div>
        </div>
        <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
      </div>
    )
  }

  return (
    <div className={styles.page} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />
      <div className={styles.inner}>
        <motion.div
          className={styles.roamHero}
          variants={fadeRise}
          initial="hidden"
          animate="visible"
          transition={springGentle}
        >
          <div className={styles.roamHeroCopy}>
            <span className={styles.heroKicker}>PERSONAL RADIO</span>
            <h1 className={styles.title}><GradientText>漫游</GradientText></h1>
            <p className={styles.subtitle}>
              从已启用平台挑选歌手。混合结果只保存在本地，单一网易云来源且已登录时可继续同步「每日漫游」。
            </p>
          </div>
          <div className={styles.roamHeroActions}>
            <span className={styles.scopeLabel}>候选范围</span>
            <div className={styles.scopePicker} role="radiogroup" aria-label="漫游候选范围">
              <button
                className={`${styles.scopeButton}${scope === 'all' ? ` ${styles.scopeButtonActive}` : ''} no-drag`}
                role="radio"
                aria-checked={scope === 'all'}
                disabled={enabledSources.length === 0}
                onClick={() => setScope('all')}
              >
                全部已启用音源
              </button>
              {enabledSources.map((source) => (
                <button
                  key={source}
                  className={`${styles.scopeButton}${scope === source ? ` ${styles.scopeButtonActive}` : ''} no-drag`}
                  role="radio"
                  aria-checked={scope === source}
                  onClick={() => setScope(source)}
                >
                  <SourceBadge source={source} compact displayMode="always" />
                  <span>{source === 'netease' ? '网易云' : 'QQ音乐'}</span>
                </button>
              ))}
            </div>
            {entries.length === 0 && (
              <motion.button
                className={`${styles.pickBtn} no-drag`}
                disabled={loading || scopeSources.length === 0}
                onClick={() => {
                  setDrafting(true)
                  setPickerOpen(true)
                }}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {loading
                  ? '正在核实已保存的漫游…'
                  : scopeSources.length === 0
                    ? '请先启用音乐平台'
                    : '选择歌手'}
              </motion.button>
            )}
          </div>
        </motion.div>

        {!drafting && availableSavedPlaylists.map((saved, index) => {
          const savedPlaylist = saved.playlist
          return (
            <motion.section
              key={saved.slot}
              className={styles.savedPlaylist}
              variants={fadeRise}
              initial="hidden"
              animate="visible"
              transition={{ ...springGentle, delay: 0.06 + index * 0.04 }}
            >
              <div className={styles.savedPlaylistCopy}>
                <span className={styles.heroKicker}>SAVED ROAM</span>
                <h2>{savedPlaylist.date === todayKey() ? '今日漫游' : '上次漫游'}</h2>
                <p>
                  {savedPlaylist.date} · {savedPlaylist.artists.length} 位歌手 · {savedPlaylist.tracks.length} 首
                </p>
                <div className={styles.resultSources}>
                  {playlistSources(savedPlaylist).map((source) => <SourceBadge key={source} source={source} reveal />)}
                  <span>{savedPlaylist.source === 'netease' && neteaseLoggedIn ? '来自网易云「每日漫游」' : '保存在本机'}</span>
                </div>
              </div>
              <div className={styles.savedPlaylistActions}>
                <button className={`${styles.savedSecondaryBtn} no-drag`} onClick={() => handleRegenerate(savedPlaylist)}>
                  重新生成
                </button>
                <motion.button
                  className={`${styles.savedPrimaryBtn} no-drag`}
                  onClick={() => setOpenedPlaylist(savedPlaylist)}
                  whileTap={tapScale}
                  transition={springSnappy}
                >
                  继续听
                </motion.button>
              </div>
            </motion.section>
          )
        })}

        {entries.length > 0 && (
          <>
            <div className={styles.entriesHeader}>
              <Toggle checked={mode === 'random'} onChange={(v) => setMode(v ? 'random' : 'hot')} label="随机模式(影响后续新增首数时的选取)" />
              <button className={`${styles.editArtistsBtn} no-drag`} onClick={() => setPickerOpen(true)}>
                + 编辑歌手(已选 {entries.length} 位)
              </button>
            </div>

            <div className={styles.library}>
              {entries.map((entry) => (
                <ArtistLibrarySection key={`${entry.artist.source}:${String(entry.artist.id)}`} entry={entry} />
              ))}
            </div>

            {error && <p className={styles.error}>{error}</p>}
            <motion.button
              className={`${styles.generateBtn} no-drag`}
              disabled={totalTracks === 0 || generating || anyLoading}
              onClick={() => { void handleGenerate() }}
              whileTap={tapScale}
              transition={springSnappy}
            >
              {generating ? '生成中…' : anyLoading ? '曲库加载中…' : `生成漫游歌单(${totalTracks} 首)`}
            </motion.button>
          </>
        )}
      </div>
      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />

      <AnimatePresence>
        {pickerOpen && (
          <ArtistPickerOverlay
            initialSelected={entries.map((e) => e.artist)}
            sources={scopeSources}
            onConfirm={handleConfirmArtists}
            onClose={() => {
              setPickerOpen(false)
              if (entries.length === 0) setDrafting(false)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
