import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useMusicService } from '../../hooks/useMusicService'
import { loadPlaylistQueue } from '../../hooks/useLazyPlaylist'
import { usePlaylistStore } from '../../stores/playlist'
import { useSettingsStore } from '../../stores/settings'
import { springGentle, springSnappy } from '../../lib/motion-presets'
import type { Playlist } from '../../types/domain'
import styles from './QuickAccessRow.module.css'
import { sizedImage } from '../../lib/image-size'

function HeartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 13.5S2 9.8 2 5.8C2 3.7 3.6 2 5.6 2c1.1 0 2 .5 2.4 1.3C8.4 2.5 9.3 2 10.4 2 12.4 2 14 3.7 14 5.8c0 4-6 7.7-6 7.7z"
        fill="currentColor"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.6c0-.9 1-1.5 1.8-1l7.7 5.4a1.2 1.2 0 0 1 0 2L5.8 14.4c-.8.5-1.8-.1-1.8-1V2.6z" fill="currentColor" />
    </svg>
  )
}

interface Item {
  key: string
  name: string
  cover?: string
  count: number
  isLiked?: boolean
  playlist: Playlist
}

/** 一格滚轮(deltaY≈100~120)约等于翻一张;触控板小增量则连续累积,视觉上是流动而非跳格。 */
const STEP_DELTA = 120
/** 滚动停下多久后吸附到整数槽位(ms):太短会打断惯性滚动,太长会让停手后悬在半路。 */
const SNAP_DELAY = 90
/** 只渲染这个槽位距离内的卡片,更远的已经完全透明,渲染出来纯属浪费。 */
const VISIBLE = 2.6
/** 相邻槽位的基础纵向间距(px),实际位移再按距离做二次衰减做出透视堆叠感。 */
const SLOT_GAP = 62
/** 超过这个槽位距离就不接受点击,避免误点到几乎看不见的背景卡。 */
const HIT_RANGE = 1.6
/** 循环滚动至少要 3 张牌,否则同一张会在多个槽位间来回跳。 */
const LOOP_MIN = 3
/** 新卡入场的起飞槽位:太远会在中心留出空档,太近又看不出「滑进来」。 */
const ENTER_FROM = 1.6
/** 速度归一化基准(槽位/秒):到这个速度就算「甩到底」,运动模糊与拉伸吃满。 */
const FULL_SPEED = 16
/** 速度平滑系数:单次 wheel 事件的瞬时速度抖得厉害,指数平滑一下才不会忽糊忽清。 */
const SPEED_SMOOTH = 0.45
/** 满速时的运动模糊上限(px)。 */
const MOTION_BLUR = 2.4
/** 满速时卡片的纵向拉伸与槽距扩张:高速像被拉长的胶片,停手回弹成一摞。 */
const SPEED_STRETCH = 0.12
const SPEED_SPREAD = 0.16
/** 中心这个半径内的卡不吃满速度效果:正在看的那张必须始终能读清名字和封面。 */
const FOCUS_RADIUS = 1.2
/** 焦点卡最多保留多少比例的运动模糊/拉伸(其余被免掉)。 */
const FOCUS_RELIEF = 0.85

/** 环形最短距离:把 i - pos 折到 [-n/2, n/2],让卡片走最近的一侧而不是绕整圈。 */
function wrapDelta(d: number, n: number): number {
  const x = ((d % n) + n) % n
  return x > n / 2 ? x - n : x
}

/**
 * 槽位几何:距离中心越远越小、越淡、间距越挤,叠成一摞有纵深的玻璃卡。
 * speed 是 0~1 的归一化滚动速度,越快槽距越开、卡越拉长、越糊 —— 速度感全在这里。
 */
function slotGeometry(off: number, speed: number) {
  const a = Math.abs(off)
  const dir = Math.sign(off)
  const s = Math.max(0.6, 1 - a * 0.12)
  // 中心附近豁免:越靠近焦点位吃到的速度效果越少,滚动中也能一直读清中间那张
  const relief = 1 - FOCUS_RELIEF * Math.max(0, 1 - a / FOCUS_RADIUS)
  // 低速几乎不糊(指数曲线),只有真的甩起来才明显 —— 慢慢翻的时候要保持锐利
  const rush = Math.pow(speed, 1.6) * relief
  // 远处卡本来就有一点景深模糊,和运动模糊叠在同一个 filter 里,避免两处 filter 打架
  const blur = Math.max(0, (a - 1.2) * 1.6) + rush * MOTION_BLUR
  return {
    y: dir * (SLOT_GAP * (1 + speed * SPEED_SPREAD) * a - a * a * 5),
    scaleX: s,
    scaleY: s * (1 + rush * SPEED_STRETCH),
    // 相邻一格内衰减放缓、之后加速淡出:滚到两张卡中间时两边都还够亮,不会整片发灰
    opacity: a <= 1 ? 1 - a * 0.26 : Math.max(0, 0.74 - (a - 1) * 0.5),
    filter: blur > 0.02 ? `blur(${blur.toFixed(2)}px)` : 'blur(0px)',
  }
}

/**
 * 个性化快捷入口:「我的歌单」叠层轮播 —— 5 个槽位的玻璃卡上下堆叠,中间一张放大且最清晰,
 * 滚轮连续驱动浮点位置(停手后吸附到整数),歌单数 ≥3 时首尾相接循环。
 * 点中间卡直接播放整个歌单,点两侧卡把它转到中间。
 */
export function QuickAccessRow() {
  const service = useMusicService()
  const activeSource = useSettingsStore((s) => s.activeSource)
  const playlists = usePlaylistStore((s) => s.playlists)
  const playlistsSource = usePlaylistStore((s) => s.playlistsSource)
  const [liked, setLiked] = useState<Playlist | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  // pos 是浮点「当前位置」:滚动中可以停在两个槽位之间,插值出连续的缩放/透明度
  const [pos, setPos] = useState(0)
  // speed 是 0~1 归一化滚动速度,驱动运动模糊/拉伸/槽距,停手后回到 0
  const [speed, setSpeed] = useState(0)
  const posRef = useRef(0)
  // 上一帧的位置:新入场的卡按「它上一帧该在哪」从边缘飞进来,而不是凭空出现在目标槽位
  const prevPosRef = useRef(0)
  const speedRef = useRef(0)
  const lastTickRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const snapTimer = useRef<number | null>(null)

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
    if (liked) {
      list.push({ key: 'liked', name: '我喜欢的音乐', count: liked.trackCount, isLiked: true, playlist: liked })
    }
    // 网易"我喜欢的音乐"本就是用户歌单列表第一项,按 id 去重避免重复展示
    const rest = playlists.filter((pl) => !liked || String(pl.id) !== String(liked.id))
    for (const pl of rest) {
      list.push({ key: String(pl.id), name: pl.name, cover: pl.cover, count: pl.trackCount, playlist: pl })
    }
    return list
  }, [liked, playlists])

  const n = items.length
  const loop = n >= LOOP_MIN

  const commit = useCallback((next: number, moving: boolean) => {
    const now = performance.now()
    const dt = Math.max(now - lastTickRef.current, 8)
    const raw = moving ? Math.abs(next - posRef.current) / (dt / 1000) : 0
    speedRef.current = moving
      ? speedRef.current * (1 - SPEED_SMOOTH) + Math.min(raw / FULL_SPEED, 1) * SPEED_SMOOTH
      : 0
    lastTickRef.current = now
    prevPosRef.current = posRef.current
    posRef.current = next
    setPos(next)
    setSpeed(speedRef.current)
  }, [])

  // 换音源后歌单变少,原位置可能越界:回到第一张
  useEffect(() => {
    if (n > 0 && posRef.current > n - 1) commit(0, false)
  }, [n, commit])

  // wheel 必须走原生非 passive 监听:React 的合成 wheel 是 passive 的,preventDefault 无效,
  // 不拦住浏览器默认行为的话滚轮会连带整页一起滚。
  useEffect(() => {
    const el = stageRef.current
    if (!el || n === 0) return
    const onWheel = (e: WheelEvent) => {
      // 歌单太少不成环时,滚到头就把滚动力还给页面,免得鼠标停在这里整页划不动
      if (!loop && ((e.deltaY < 0 && posRef.current <= 0) || (e.deltaY > 0 && posRef.current >= n - 1))) return
      e.preventDefault()
      const raw = posRef.current + e.deltaY / STEP_DELTA
      commit(loop ? raw : Math.min(Math.max(raw, 0), n - 1), true)
      if (snapTimer.current) window.clearTimeout(snapTimer.current)
      snapTimer.current = window.setTimeout(() => {
        const t = Math.round(posRef.current)
        commit(loop ? ((t % n) + n) % n : t, false)
      }, SNAP_DELAY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (snapTimer.current) window.clearTimeout(snapTimer.current)
    }
  }, [commit, loop, n])

  async function play(item: Item) {
    if (pendingKey) return
    setPendingKey(item.key)
    try {
      const queue = await loadPlaylistQueue(item.playlist)
      if (queue.length) usePlaylistStore.getState().setQueue(queue, 0, item.playlist.id)
    } catch {
      // 拉取失败静默忽略:入口本身不是主路径,详情页里还能重试
    } finally {
      setPendingKey(null)
    }
  }

  if (n === 0) return null

  const posNorm = ((pos % n) + n) % n
  const thumbHeight = Math.max(100 / n, 14)

  return (
    <motion.section
      className={`${styles.panel} no-drag`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springGentle}
    >
      <div className={styles.body}>
        <div className={styles.stage} ref={stageRef}>
          {items.map((item, i) => {
            const off = loop ? wrapDelta(i - pos, n) : i - pos
            const a = Math.abs(off)
            if (a > VISIBLE) return null
            // 入场起点取「上一帧的槽位」并夹在可视边缘:快速滚动时卡片是从画面外飞进来的,
            // 而不是直接闪现在目标位置 —— 这一步才是速度感的来源。
            const prevOff = loop ? wrapDelta(i - prevPosRef.current, n) : i - prevPosRef.current
            const enterOff = Math.max(-ENTER_FROM, Math.min(ENTER_FROM, prevOff))
            const center = a < 0.5
            const busy = pendingKey === item.key
            return (
              <motion.button
                key={item.key}
                className={styles.card}
                data-center={center ? '1' : undefined}
                // 近处才开毛玻璃:5 层 backdrop-filter 同屏太贵,远处透明度已低到看不出差别
                data-glass={a < 1.5 ? '1' : undefined}
                style={{
                  zIndex: Math.round(100 - a * 20),
                  pointerEvents: a > HIT_RANGE ? 'none' : 'auto',
                }}
                initial={slotGeometry(enterOff, speed)}
                animate={slotGeometry(off, speed)}
                transition={springSnappy}
                tabIndex={a > HIT_RANGE ? -1 : 0}
                aria-hidden={a > HIT_RANGE || undefined}
                onClick={() => { if (center) void play(item); else commit(pos + off, false) }}
                title={center ? `${item.name} · 点击播放` : item.name}
              >
                {item.isLiked
                  ? <span className={styles.iconWrap}><HeartIcon /></span>
                  : item.cover
                    ? <img className={styles.cover} src={sizedImage(item.cover, 112)} alt="" loading="lazy" />
                    : <span className={styles.cover} />}
                <span className={styles.meta}>
                  <span className={styles.name}>{item.name}</span>
                  {item.count > 0 && <span className={styles.hint}>{item.count} 首</span>}
                </span>
                <span className={busy ? styles.badgeBusy : styles.badge}>
                  {busy ? <span className={styles.spinner} /> : <PlayIcon />}
                </span>
              </motion.button>
            )
          })}
          <span className={styles.glow} aria-hidden="true" />
        </div>

        <div className={styles.rail}>
          <span className={styles.railBase} />
          <span
            className={styles.railThumb}
            style={{ height: `${thumbHeight}%`, top: `${(posNorm / n) * (100 - thumbHeight)}%` }}
          />
        </div>
      </div>
    </motion.section>
  )
}
