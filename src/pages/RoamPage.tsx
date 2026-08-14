import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'
import { todayKey, useRoamStore } from '../stores/roam'
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

export function RoamPage() {
  const enabledSignature = useProviderStore((state) =>
    PROVIDER_IDS.map((source) => state.byId[source].enabled && state.byId[source].auth === 'authenticated' ? '1' : '0').join('')
  )
  const enabledSources = useMemo(
    () => PROVIDER_IDS.filter((_, index) => enabledSignature[index] === '1') as ProviderId[],
    [enabledSignature]
  )
  const playlist = useRoamStore((s) => s.playlist)
  const entries = useRoamStore((s) => s.entries)
  const mode = useRoamStore((s) => s.mode)
  const scope = useRoamStore((s) => s.scope)
  const generating = useRoamStore((s) => s.generating)
  const confirmArtists = useRoamStore((s) => s.confirmArtists)
  const setMode = useRoamStore((s) => s.setMode)
  const setScope = useRoamStore((s) => s.setScope)
  const generate = useRoamStore((s) => s.generate)
  const reset = useRoamStore((s) => s.reset)
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const loading = useRoamStore((s) => s.loading)
  const error = useRoamStore((s) => s.error)

  const [pickerOpen, setPickerOpen] = useState(false)

  const { topOpacity, bottomOpacity, handleScroll } = useScrollGradient()
  const scopeSources = scope === 'all' ? enabledSources : enabledSources.filter((source) => source === scope)
  const visiblePlaylist = playlist && playlist.tracks.every((track) =>
    !PROVIDER_IDS.includes(track.source as ProviderId) || enabledSources.includes(track.source as ProviderId)
  ) ? playlist : null
  const hasInactiveEntries = entries.some((entry) =>
    entry.artist.source !== 'local' && !enabledSources.includes(entry.artist.source)
  )

  const totalTracks = entries.reduce((n, e) => n + e.tracks.length, 0)
  const anyLoading = entries.some((e) => e.loading)

  useEffect(() => {
    if (scope !== 'all' && !enabledSources.includes(scope)) setScope('all')
    else if (hasInactiveEntries) setScope('all')
    if (playlist && !visiblePlaylist) reset()
    setPickerOpen(false)
  }, [enabledSignature, enabledSources, hasInactiveEntries, playlist, reset, scope, setScope, visiblePlaylist])

  useEffect(() => {
    useRoamStore.getState().clearSuggestions()
    setPickerOpen(false)
  }, [enabledSignature])

  // 只有明确选择网易云单平台时才读取远端「每日漫游」；混合范围始终以本地为基线。
  useEffect(() => {
    if (scope !== 'netease' || !neteaseLoggedIn || !enabledSources.includes('netease')) return
    void useRoamStore.getState().ensureNeteaseHydrated(serviceFor('netease'))
  }, [enabledSources, neteaseLoggedIn, scope])

  function playAt(index: number) {
    if (!visiblePlaylist) return
    usePlaylistStore.getState().setQueue(visiblePlaylist.tracks, index)
  }

  function handleConfirmArtists(artists: Parameters<typeof confirmArtists>[0]) {
    confirmArtists(artists)
    setPickerOpen(false)
  }

  if (scope === 'netease' && loading && !visiblePlaylist) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <h1 className={styles.title}><GradientText>漫游</GradientText></h1>
          <p className={styles.subtitle}>正在核实账号里的漫游歌单…</p>
        </div>
      </div>
    )
  }

  if (visiblePlaylist) {
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
                <GradientText>{visiblePlaylist.date === todayKey() ? '今日漫游' : '上次漫游'}</GradientText>
              </h1>
              <p className={styles.subtitle}>
                {visiblePlaylist.date === todayKey() ? null : `${visiblePlaylist.date} · `}
                {visiblePlaylist.artists.length} 位歌手 · {visiblePlaylist.tracks.length} 首
              </p>
              <div className={styles.resultSources}>
                {visiblePlaylist.source === 'mixed'
                  ? PROVIDER_IDS.filter((source) => visiblePlaylist.tracks.some((track) => track.source === source))
                    .map((source) => <SourceBadge key={source} source={source} reveal />)
                  : <SourceBadge source={visiblePlaylist.source} reveal />}
                <span>{visiblePlaylist.source === 'netease' && neteaseLoggedIn ? '已同步平台歌单' : '保存在本地'}</span>
              </div>
            </div>
            <motion.button
              className={`${styles.resetBtn} no-drag`}
              onClick={reset}
              whileTap={tapScale}
              transition={springSnappy}
            >
              重新选择
            </motion.button>
          </motion.div>
          <motion.div
            className={styles.trackList}
            variants={fadeRise}
            initial="hidden"
            animate="visible"
            transition={{ ...springGentle, delay: 0.08 }}
          >
            {visiblePlaylist.tracks.map((track, i) => (
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
                  <SourceBadge source={source} />
                  <span>{source === 'netease' ? '网易云' : 'QQ音乐'}</span>
                </button>
              ))}
            </div>
            {entries.length === 0 && (
              <motion.button
                className={`${styles.pickBtn} no-drag`}
                disabled={scopeSources.length === 0}
                onClick={() => setPickerOpen(true)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {scopeSources.length === 0 ? '请先启用音乐平台' : '选择歌手'}
              </motion.button>
            )}
          </div>
        </motion.div>

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
              onClick={() => { void generate() }}
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
            onClose={() => setPickerOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
