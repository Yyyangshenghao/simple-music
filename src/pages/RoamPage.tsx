import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMusicService } from '../hooks/useMusicService'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'
import { todayKey, useRoamStore } from '../stores/roam'
import { ArtistPickerOverlay } from '../components/Roam/ArtistPickerOverlay'
import { ArtistLibrarySection } from '../components/Roam/ArtistLibrarySection'
import { TrackRow } from '../components/Explore/TrackRow'
import { Toggle } from '../components/ui/Toggle'
import { GradientText } from '../components/ui/GradientText'
import { fadeRise, springGentle, springSnappy, tapScale } from '../lib/motion-presets'
import styles from './RoamPage.module.css'

export function RoamPage() {
  const service = useMusicService()
  const activeSource = useSettingsStore((s) => s.activeSource)
  const playlist = useRoamStore((s) => s.playlist)
  const entries = useRoamStore((s) => s.entries)
  const mode = useRoamStore((s) => s.mode)
  const generating = useRoamStore((s) => s.generating)
  const confirmArtists = useRoamStore((s) => s.confirmArtists)
  const setMode = useRoamStore((s) => s.setMode)
  const generate = useRoamStore((s) => s.generate)
  const reset = useRoamStore((s) => s.reset)
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const loading = useRoamStore((s) => s.loading)

  const [pickerOpen, setPickerOpen] = useState(false)

  const { topOpacity, bottomOpacity, handleScroll } = useScrollGradient()

  const totalTracks = entries.reduce((n, e) => n + e.tracks.length, 0)
  const anyLoading = entries.some((e) => e.loading)

  // 音源切换后,已生成的歌单/进行中的选歌手若属于旧音源,一律视为过期清空——直接比对存量数据自带的
  // source 字段而非记录”上次挂载时的音源”,这样即使切源发生在 RoamPage 未挂载期间(如在别的页面用
  // 头像菜单切源),重新挂载时也能在这次 effect 里侦测到不匹配并清空,不会让旧音源数据带着挂载。
  // 建议无限流同理是源绑定的(相似歌手/常听排行都按当前音源拉取),一并清空重新种子。
  useEffect(() => {
    const s = useRoamStore.getState()
    const stale =
      (s.playlist && s.playlist.source !== activeSource) ||
      s.entries.some((e) => e.artist.source !== activeSource)
    if (stale) useRoamStore.getState().reset()
    useRoamStore.getState().clearSuggestions()
    setPickerOpen(false)
  }, [activeSource])

  // 网易云:挂载/切回网易云时核实账号里是否已有可复用的「每日漫游」真实歌单
  useEffect(() => {
    if (activeSource !== 'netease' || !neteaseLoggedIn) return
    void useRoamStore.getState().ensureNeteaseHydrated(service)
  }, [activeSource, neteaseLoggedIn, service])

  function playAt(index: number) {
    if (!playlist) return
    usePlaylistStore.getState().setQueue(playlist.tracks, index)
  }

  function handleConfirmArtists(artists: Parameters<typeof confirmArtists>[0]) {
    confirmArtists(artists)
    setPickerOpen(false)
  }

  if (activeSource === 'netease' && !neteaseLoggedIn) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <h1 className={styles.title}><GradientText>漫游</GradientText></h1>
          <p className={styles.subtitle}>登录网易云账号后才能使用「漫游」</p>
        </div>
      </div>
    )
  }

  if (activeSource === 'netease' && loading && !playlist) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <h1 className={styles.title}><GradientText>漫游</GradientText></h1>
          <p className={styles.subtitle}>正在核实账号里的漫游歌单…</p>
        </div>
      </div>
    )
  }

  if (playlist) {
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
                <GradientText>{playlist.date === todayKey() ? '今日漫游' : '上次漫游'}</GradientText>
              </h1>
              <p className={styles.subtitle}>
                {playlist.date === todayKey() ? null : `${playlist.date} · `}
                {playlist.artists.length} 位歌手 · {playlist.tracks.length} 首
              </p>
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
            {playlist.tracks.map((track, i) => (
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
        <motion.div variants={fadeRise} initial="hidden" animate="visible" transition={springGentle}>
          <h1 className={styles.title}><GradientText>漫游</GradientText></h1>
          <p className={styles.subtitle}>
            {activeSource === 'netease'
              ? '挑几位今天想听的歌手,生成一份「每日漫游」歌单,写进你的网易云账号(隐私歌单),当天可反复听'
              : '挑几位今天想听的歌手,生成一份临时歌单,当天听,不写进你的平台歌单'}
          </p>
        </motion.div>

        {entries.length === 0 ? (
          <motion.button
            className={`${styles.pickBtn} no-drag`}
            onClick={() => setPickerOpen(true)}
            whileTap={tapScale}
            transition={springSnappy}
          >
            选择歌手
          </motion.button>
        ) : (
          <>
            <div className={styles.entriesHeader}>
              <Toggle checked={mode === 'random'} onChange={(v) => setMode(v ? 'random' : 'hot')} label="随机模式(影响后续新增首数时的选取)" />
              <button className={`${styles.editArtistsBtn} no-drag`} onClick={() => setPickerOpen(true)}>
                + 编辑歌手(已选 {entries.length} 位)
              </button>
            </div>

            <div className={styles.library}>
              {entries.map((entry) => (
                <ArtistLibrarySection key={String(entry.artist.id)} entry={entry} />
              ))}
            </div>

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
            onConfirm={handleConfirmArtists}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
