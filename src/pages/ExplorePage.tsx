import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMusicService } from '../hooks/useMusicService'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { usePlaylistStore } from '../stores/playlist'
import { useNavigationStore } from '../stores/navigation'
import { AnimatedTrackRow } from '../components/Explore/AnimatedTrackRow'
import { HeroCard } from '../components/Explore/HeroCard'
import { RecentRail } from '../components/Explore/RecentRail'
import { Stack } from '../components/Explore/Stack'
import { PlaylistPreviewModal } from '../components/Explore/PlaylistPreviewModal'
import { GradientText } from '../components/ui/GradientText'
import { fadeRise, springGentle } from '../lib/motion-presets'
import { createPool, needsRefill, redeal, refill, swipeTop, type StackPoolState } from '../lib/stack-pool'
import type { RadarPlaylist } from '../lib/music-service'
import type { Playlist, Track } from '../types/domain'
import styles from './ExplorePage.module.css'

const EMPTY_POOL: StackPoolState<Playlist> = { hand: [], reserve: [], discarded: [] }

export function ExplorePage() {
  const service = useMusicService()
  const [pool, setPool] = useState(EMPTY_POOL)
  const [poolLoaded, setPoolLoaded] = useState(false)
  const [dailySongs, setDailySongs] = useState<Track[]>([])
  const [radar, setRadar] = useState<RadarPlaylist | null>(null)
  const [preview, setPreview] = useState<Playlist | null>(null)
  const refilling = useRef(false)
  const loadSession = useRef(0)
  // 推荐歌单分页游标：0 = personalized，之后每次补货翻一页（歌单广场热门，可无限翻）
  const pageRef = useRef(0)
  // 换一叠计数：作为 Stack 外层 AnimatePresence 的 key，触发整叠出/入场动画
  const [dealId, setDealId] = useState(0)

  // 歌单详情提升到导航 store：顶栏前进/后退可穿越
  const currentView = useNavigationStore((s) => s.currentView)
  const detail =
    typeof currentView === 'object' && currentView.type === 'playlist' && currentView.from === 'explore'
      ? currentView
      : null

  const { topOpacity, bottomOpacity, handleScroll, setTopOpacity, setBottomOpacity } = useScrollGradient()

  useEffect(() => {
    // 音源切换后丢弃在途响应，避免旧源数据混入新源状态
    const session = ++loadSession.current
    setPool(EMPTY_POOL)
    setPoolLoaded(false)
    setDailySongs([])
    setRadar(null)
    pageRef.current = 0
    void service.getRecommendPlaylists(0)
      .then((pls) => {
        if (loadSession.current !== session) return
        pageRef.current = 1
        setPool(createPool(pls))
      })
      .catch(() => {})
      .finally(() => { if (loadSession.current === session) setPoolLoaded(true) })
    void service.getDailySongs?.()
      .then((songs) => { if (loadSession.current === session) setDailySongs(songs) })
      .catch(() => {})
    void service.getRadarPlaylist?.()
      .then((r) => { if (loadSession.current === session) setRadar(r) })
      .catch(() => {})
  }, [service])

  // 池子见底时翻下一页补一批（id 去重；页码递增让内容不再循环，请求失败时由 swipeTop 回收兜底）
  useEffect(() => {
    if (pool.hand.length === 0 || !needsRefill(pool) || refilling.current) return
    refilling.current = true
    const session = loadSession.current
    service.getRecommendPlaylists(pageRef.current)
      .then((pls) => {
        if (loadSession.current !== session) return
        pageRef.current += 1
        setPool((p) => refill(p, pls, (x) => x.id))
      })
      .catch(() => {})
      .finally(() => { refilling.current = false })
  }, [pool, service])

  // 详情开合的所有路径（页内返回键、顶栏前进/后退）都重置滚动渐变遮罩
  useEffect(() => {
    setTopOpacity(0)
    setBottomOpacity(0)
  }, [detail, setTopOpacity, setBottomOpacity])

  const handleSwipe = useCallback(() => setPool((p) => swipeTop(p)), [])

  // 换一叠：整手弃掉换新手牌，dealId 变更触发旧叠移出/新叠移入动画
  const handleRedeal = useCallback(() => {
    setDealId((n) => n + 1)
    setPool((p) => redeal(p))
  }, [])

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  function openDaily() {
    if (dailySongs.length === 0) return
    const pl: Playlist = {
      provider: 'netease',
      source: 'netease',
      type: 'playlist',
      id: 'netease-daily-songs',
      name: '每日推荐',
      cover: dailySongs[0]?.cover ?? '',
      trackCount: dailySongs.length,
      playCount: 0,
      creator: '',
    }
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist: pl, tracks: dailySongs })
  }

  function openRadar() {
    if (!radar) return
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist: radar.playlist, tracks: radar.tracks })
  }

  if (detail) {
    return (
      <div className={styles.page} onScroll={handleScroll}>
        <div className="topGradient" style={{ opacity: topOpacity }} />
        <div className={styles.detailHeader}>
          <button className={`${styles.backBtn} no-drag`} onClick={() => useNavigationStore.getState().goBack()}>← 返回</button>
          <div className={styles.detailMeta}>
            {detail.playlist.cover && (
              <motion.img
                className={styles.detailCover}
                src={detail.playlist.cover}
                alt=""
                layoutId={`explore-cover-${String(detail.playlist.id)}`}
                transition={springGentle}
              />
            )}
            <motion.div variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
              <h1 className={styles.detailTitle}><GradientText>{detail.playlist.name}</GradientText></h1>
              <p className={styles.detailSub}>{detail.tracks.length} 首</p>
            </motion.div>
          </div>
        </div>
        <motion.div className={styles.trackList} variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
          {detail.tracks.map((t, i) => (
            <AnimatedTrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} delay={0.15 + i * 0.05} />
          ))}
        </motion.div>
        <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
      </div>
    )
  }

  const top = pool.hand.length > 0 ? pool.hand[pool.hand.length - 1] : null
  const hasSideCards = dailySongs.length > 0 || radar !== null

  return (
    <div className={styles.page} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />

      <motion.section className={styles.hero} variants={fadeRise} initial="hidden" animate="visible" transition={springGentle}>
        {hasSideCards && (
          <div className={styles.heroCards}>
            {dailySongs.length > 0 && (
              <HeroCard
                title="每日推荐"
                subtitle={`${dailySongs.length} 首 · 每天更新`}
                cover={dailySongs[0]?.cover}
                badge={<span>{new Date().getDate()}</span>}
                layoutId="explore-cover-netease-daily-songs"
                onClick={openDaily}
              />
            )}
            {radar && (
              <HeroCard
                title="私人雷达"
                subtitle={`${radar.tracks.length} 首 · 根据你的口味`}
                cover={radar.playlist.cover}
                layoutId={`explore-cover-${String(radar.playlist.id)}`}
                onClick={openRadar}
              />
            )}
          </div>
        )}

        {pool.hand.length > 0 && (
          <div className={styles.stage}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={dealId}
                initial={{ x: 90, opacity: 0, rotate: 6 }}
                animate={{ x: 0, opacity: 1, rotate: 0 }}
                exit={{ x: -110, opacity: 0, rotate: -8, transition: { duration: 0.22, ease: 'easeIn' } }}
                transition={springGentle}
              >
                <Stack cards={pool.hand} onSwipe={handleSwipe} onCardClick={setPreview} />
              </motion.div>
            </AnimatePresence>
            {top && (
              <div className={styles.topInfo}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={String(top.id)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                  >
                    <p className={styles.topName}>{top.name}</p>
                    {top.description && <p className={styles.topDesc}>{top.description}</p>}
                  </motion.div>
                </AnimatePresence>
                <p className={styles.topHint}>拖拽换一张 · 点击看曲目</p>
                <button className={`${styles.redealBtn} no-drag`} onClick={handleRedeal}>↻ 换一叠</button>
              </div>
            )}
          </div>
        )}

        {poolLoaded && pool.hand.length === 0 && !hasSideCards && (
          <p className={styles.empty}>暂时没有推荐内容</p>
        )}
      </motion.section>

      {service.getRecentPlaylists && <RecentRail onOpen={setPreview} />}

      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
      <PlaylistPreviewModal playlist={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
