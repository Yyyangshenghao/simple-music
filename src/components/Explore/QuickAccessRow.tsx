import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMusicService } from '../../hooks/useMusicService'
import { useLazyPlaylist } from '../../hooks/useLazyPlaylist'
import { usePlaylistStore } from '../../stores/playlist'
import { useSettingsStore } from '../../stores/settings'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import type { Playlist } from '../../types/domain'
import styles from './QuickAccessRow.module.css'

function HeartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 13.5S2 9.8 2 5.8C2 3.7 3.6 2 5.6 2c1.1 0 2 .5 2.4 1.3C8.4 2.5 9.3 2 10.4 2 12.4 2 14 3.7 14 5.8c0 4-6 7.7-6 7.7z"
        fill="currentColor"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.6c0-.9 1-1.5 1.8-1l7.7 5.4a1.2 1.2 0 0 1 0 2L5.8 14.4c-.8.5-1.8-.1-1.8-1V2.6z" fill="currentColor" />
    </svg>
  )
}

interface Item {
  key: string
  name: string
  cover?: string
  isLiked?: boolean
  playlist: Playlist
}

// items 为空的瞬间(冷启动加载中)也要无条件调用 useLazyPlaylist,满足 hooks 调用顺序规则;
// 这个 id 不会命中真实歌单,首次失败请求会被 hook 内部 catch 并缓存为 error,之后不会重复请求。
const EMPTY_PLAYLIST: Playlist = {
  provider: 'netease',
  source: 'netease',
  type: 'playlist',
  id: '__quick-access-empty__',
  name: '',
  cover: '',
  trackCount: 0,
  playCount: 0,
  creator: ''
}

/** 滚轮切换的一格判定阈值:太小会把触控板惯性滚动的噪音也当成一次切换。 */
const WHEEL_THRESHOLD = 6
/** 一次切换的冷却时间:略短于 springSnappy 动画时长,让连续大幅滚动时能更快连续切换。 */
const WHEEL_COOLDOWN = 220

const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, y: dir * 26 }),
  center: { opacity: 1, y: 0 },
  exit: (dir: number) => ({ opacity: 0, y: -dir * 26 })
}

/** 个性化快捷入口：单条大横幅同一时刻只展示一个歌单，鼠标滚轮按歌单顺序切换，点击直接播放（不进详情页）。 */
export function QuickAccessRow() {
  const service = useMusicService()
  const activeSource = useSettingsStore((s) => s.activeSource)
  const playlists = usePlaylistStore((s) => s.playlists)
  const playlistsSource = usePlaylistStore((s) => s.playlistsSource)
  const [liked, setLiked] = useState<Playlist | null>(null)
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const wheelAccum = useRef(0)
  const lockedRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // 「我的库」已有的用户歌单 store：与 LibraryPage 共享同一份数据/加载状态
  useEffect(() => {
    if (playlistsSource !== activeSource) {
      void usePlaylistStore.getState().loadUserPlaylists()
    }
  }, [playlistsSource, activeSource])

  useEffect(() => {
    let cancelled = false
    setLiked(null)
    service.getLikedPlaylist?.()
      .then((pl) => { if (!cancelled) setLiked(pl) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [service])

  const items: Item[] = useMemo(() => {
    const list: Item[] = []
    if (liked) list.push({ key: 'liked', name: '我喜欢的音乐', isLiked: true, playlist: liked })
    // 网易"我喜欢的音乐"本就是用户歌单列表第一项,按 id 去重避免重复展示
    const rest = playlists.filter((pl) => !liked || String(pl.id) !== String(liked.id))
    for (const pl of rest.slice(0, 10)) {
      list.push({ key: String(pl.id), name: pl.name, cover: pl.cover, playlist: pl })
    }
    return list
  }, [liked, playlists])

  // 用取模兜底,而不是额外 effect 同步:歌单列表变短导致 index 越界时,渲染期直接算出合法下标
  const safeIndex = items.length ? ((index % items.length) + items.length) % items.length : 0
  const current = items[safeIndex] ?? null
  const { total, makeQueue } = useLazyPlaylist(current?.playlist ?? EMPTY_PLAYLIST)

  function step(delta: number) {
    if (lockedRef.current || items.length < 2) return
    lockedRef.current = true
    setDirection(delta)
    setIndex((i) => i + delta)
    setTimeout(() => { lockedRef.current = false }, WHEEL_COOLDOWN)
  }

  // React 17+ 给 onWheel 挂的是 passive 监听器,e.preventDefault() 会静默失效(控制台报警告),
  // 导致页面跟着滚轮一起滚、横幅被滚出鼠标位置后再也切不到下一格 —— 必须手动挂非 passive 原生监听器。
  useEffect(() => {
    const el = panelRef.current
    if (!el || items.length < 2) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      // 冷却期内的滚轮事件直接丢弃,不参与累加:否则会把这段滚动力度清零而不触发切换,
      // 冷却结束后还要重新攒够阈值才动,造成明显的滞后感。
      if (lockedRef.current) return
      wheelAccum.current += e.deltaY
      if (Math.abs(wheelAccum.current) < WHEEL_THRESHOLD) return
      const dir = wheelAccum.current > 0 ? 1 : -1
      wheelAccum.current = 0
      step(dir)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  function playCurrent() {
    if (!current || total === 0) return
    usePlaylistStore.getState().setQueue(makeQueue(), 0, current.playlist.id)
  }

  if (!current) return null

  return (
    <div ref={panelRef} className={`${styles.panel} no-drag`}>
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.button
          key={current.key}
          className={styles.bar}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={springSnappy}
          whileHover={{ scale: 1.02 }}
          whileTap={tapScale}
          onClick={playCurrent}
          title={`${current.name} · 点击播放`}
        >
          {current.isLiked
            ? <span className={styles.iconWrap}><HeartIcon /></span>
            : current.cover
              ? <img className={styles.cover} src={current.cover} alt="" loading="lazy" />
              : <span className={styles.coverFallback} />}
          <span className={styles.meta}>
            <span className={styles.name}>{current.name}</span>
            <span className={styles.hint}>{total > 0 ? `${total} 首 · 滚轮切换` : '滚轮切换歌单'}</span>
          </span>
          <span className={styles.playBadge}><PlayIcon /></span>
        </motion.button>
      </AnimatePresence>
      {items.length > 1 && (
        <div className={styles.dots}>
          {items.map((it, i) => (
            <span key={it.key} className={i === safeIndex ? styles.dotActive : styles.dot} />
          ))}
        </div>
      )}
    </div>
  )
}
