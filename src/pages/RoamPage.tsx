import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useMusicService } from '../hooks/useMusicService'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'
import { useRoamStore, MAX_ARTISTS } from '../stores/roam'
import { TrackRow } from '../components/Explore/TrackRow'
import { Toggle } from '../components/ui/Toggle'
import { GradientText } from '../components/ui/GradientText'
import { fadeRise, springGentle, springSnappy, tapScale } from '../lib/motion-presets'
import type { ArtistInfo } from '../types/domain'
import styles from './RoamPage.module.css'

export function RoamPage() {
  const service = useMusicService()
  const activeSource = useSettingsStore((s) => s.activeSource)
  const playlist = useRoamStore((s) => s.playlist)
  const selectedArtists = useRoamStore((s) => s.selectedArtists)
  const mode = useRoamStore((s) => s.mode)
  const generating = useRoamStore((s) => s.generating)
  const addArtist = useRoamStore((s) => s.addArtist)
  const removeArtist = useRoamStore((s) => s.removeArtist)
  const setMode = useRoamStore((s) => s.setMode)
  const generate = useRoamStore((s) => s.generate)
  const reset = useRoamStore((s) => s.reset)

  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<ArtistInfo[]>([])
  const [searching, setSearching] = useState(false)
  const searchSeq = useRef(0)

  const { topOpacity, bottomOpacity, handleScroll } = useScrollGradient()

  // 音源切换后,已生成的歌单/进行中的选歌手若属于旧音源,一律视为过期清空——直接比对存量数据自带的
  // source 字段而非记录“上次挂载时的音源”,这样即使切源发生在 RoamPage 未挂载期间(如在别的页面用
  // 头像菜单切源),重新挂载时也能在这次 effect 里侦测到不匹配并清空,不会让旧音源数据带着挂载。
  useEffect(() => {
    const s = useRoamStore.getState()
    const stale =
      (s.playlist && s.playlist.source !== activeSource) ||
      s.selectedArtists.some((a) => a.source !== activeSource)
    if (stale) useRoamStore.getState().reset()
    setKeyword('')
    setResults([])
  }, [activeSource])

  useEffect(() => {
    const q = keyword.trim()
    if (!q) {
      searchSeq.current++
      setResults([])
      setSearching(false)
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const timer = setTimeout(() => {
      service.searchArtists(q)
        .then((artists) => { if (seq === searchSeq.current) setResults(artists) })
        .catch(() => { if (seq === searchSeq.current) setResults([]) })
        .finally(() => { if (seq === searchSeq.current) setSearching(false) })
    }, 250)
    return () => clearTimeout(timer)
  }, [keyword, service])

  function isSelected(artist: ArtistInfo): boolean {
    return selectedArtists.some((a) => String(a.id) === String(artist.id))
  }

  function playAt(index: number) {
    if (!playlist) return
    usePlaylistStore.getState().setQueue(playlist.tracks, index)
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
              <h1 className={styles.title}><GradientText>今日漫游</GradientText></h1>
              <p className={styles.subtitle}>{playlist.artists.length} 位歌手 · {playlist.tracks.length} 首</p>
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
          <p className={styles.subtitle}>挑几位今天想听的歌手,生成一份临时歌单,当天听,不写进你的平台歌单</p>
        </motion.div>

        <div className={styles.searchBox}>
          <input
            className={`${styles.searchInput} no-drag`}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索歌手…"
          />
        </div>

        {searching && <p className={styles.hint}>搜索中…</p>}

        {results.length > 0 && (
          <div className={styles.resultList}>
            {results.map((artist, i) => {
              const selected = isSelected(artist)
              const disabled = !selected && selectedArtists.length >= MAX_ARTISTS
              return (
                <button
                  key={`${artist.source}-${String(artist.id)}-${i}`}
                  className={`${styles.artistRow} no-drag${disabled ? ` ${styles.artistRowDisabled}` : ''}`}
                  disabled={disabled}
                  onClick={() => (selected ? removeArtist(artist.id) : addArtist(artist))}
                >
                  {artist.avatar && <img className={styles.artistAvatar} src={artist.avatar} alt="" loading="lazy" />}
                  <span className={styles.artistName}>{artist.name}</span>
                  {selected && <span className={styles.artistCheck}>已选</span>}
                </button>
              )
            })}
          </div>
        )}

        {selectedArtists.length > 0 && (
          <div className={styles.chips}>
            {selectedArtists.map((artist) => (
              <span key={String(artist.id)} className={styles.chip}>
                {artist.name}
                <button
                  className={`${styles.chipRemove} no-drag`}
                  onClick={() => removeArtist(artist.id)}
                  aria-label={`移除 ${artist.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className={styles.modeRow}>
          <Toggle checked={mode === 'random'} onChange={(v) => setMode(v ? 'random' : 'hot')} label="随机模式" />
        </div>

        <motion.button
          className={`${styles.generateBtn} no-drag`}
          disabled={selectedArtists.length === 0 || generating}
          onClick={() => { void generate() }}
          whileTap={tapScale}
          transition={springSnappy}
        >
          {generating ? '生成中…' : '生成漫游歌单'}
        </motion.button>
      </div>
    </div>
  )
}
