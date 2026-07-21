import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { useMusicService } from '../../hooks/useMusicService'
import { useRoamStore, MAX_ARTISTS } from '../../stores/roam'
import {
  createArtistGraphSimulation,
  getLinkForce,
  jitterNear,
  type GraphSimNode,
  type GraphSimLink,
} from '../../lib/artist-graph-sim'
import { ArtistPill } from '../Explore/ArtistPill'
import { CloseIcon } from '../ui/CloseIcon'
import { springGentle, springSnappy, tapScale } from '../../lib/motion-presets'
import type { Simulation } from 'd3-force'
import type { MusicService } from '../../lib/music-service'
import type { ArtistInfo } from '../../types/domain'
import styles from './ArtistPickerOverlay.module.css'

interface ArtistPickerOverlayProps {
  /** 重开编辑时预置已选歌手(保留选中态,曲库池等到确认时由 store 决定是否复用)。 */
  initialSelected: ArtistInfo[]
  onConfirm(artists: ArtistInfo[]): void
  onClose(): void
}

/** 节点的结构性状态(选中/是否已展开等),交给 React 渲染。位置(x/y)交给 d3 力导向仿真,不进这里。 */
interface NodeMeta {
  id: string
  artist: ArtistInfo
  selected: boolean
  expanded: boolean
  expanding: boolean
  parentId: string | null
  /** 同一批生长出来的兄弟节点里的序号,驱动错峰弹入动画的 delay。 */
  spawnIndex: number
}

const CANVAS_W = 3600
const CANVAS_H = 2600
const CENTER = { x: CANVAS_W / 2, y: CANVAS_H / 2 }
const PAD = 90

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 每次生长 4~6 位相似歌手。 */
function randomChildCount(): number {
  return 4 + Math.floor(Math.random() * 3)
}

interface ArtistGraphNodeContentProps {
  meta: NodeMeta
  disabled: boolean
  onToggle(meta: NodeMeta): void
}

/**
 * memo 包裹:节点一多,任何一次选中/生长都会让 nodeMetas 数组整体重新 map 一遍,未变化的节点
 * 元素引用不变(见父组件里 `.map` 的更新写法),这里配合 onToggle 的 useCallback 稳定引用,
 * 靠 React.memo 的浅比较把没变化的节点整段跳过重渲染——不然几十上百个节点每次点选都全量重渲染,
 * 越选越卡的根源之一。
 */
const ArtistGraphNodeContent = memo(function ArtistGraphNodeContent({ meta, disabled, onToggle }: ArtistGraphNodeContentProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...springSnappy, delay: meta.parentId ? meta.spawnIndex * 0.06 : 0 }}
    >
      <ArtistPill
        artist={meta.artist}
        selected={meta.selected}
        disabled={disabled}
        onClick={() => onToggle(meta)}
      />
      {meta.expanding && <span className={styles.expandingDot} aria-hidden="true" />}
    </motion.div>
  )
})

/**
 * 选歌手的全屏画布视图:歌手节点用 d3-force 力导向仿真摆位(排斥不聚堆 + 碰撞不重叠 + 连线弹簧把子节点
 * 拉在父节点附近),点选一位后从它周围「生长」出 4~6 位相似歌手,新节点从父节点旁小范围抖动出发,交给
 * 仿真自己弹开、不会挤压出重叠。搜索到的歌手也会落进同一张画布参与生长。选择过程只在本组件内维护
 * (不进 store),确认时才一次性提交给 useRoamStore().confirmArtists,取消关闭则整段丢弃。
 *
 * 位置数据分两条线:d3 仿真拥有并持续 mutate 一份 GraphSimNode[](仅 id/x/y),每次 tick 直接写 DOM
 * (ref + style.transform),不经过 React state,避免几十个节点 60fps 重渲染;React state(nodeMetas)
 * 只管结构性数据(选中/展开/父子关系),新增/移除节点这类结构变化才触发一次渲染去挂载/卸载 DOM。
 */
export function ArtistPickerOverlay({ initialSelected, onConfirm, onClose }: ArtistPickerOverlayProps) {
  const service = useMusicService()
  const serviceRef = useRef<MusicService>(service)
  serviceRef.current = service

  const suggestions = useRoamStore((s) => s.suggestions)
  const suggestionsLoaded = useRoamStore((s) => s.suggestionsLoaded)

  const [nodeMetas, setNodeMetas] = useState<NodeMeta[]>([])
  const nodeMetasRef = useRef<NodeMeta[]>([])
  nodeMetasRef.current = nodeMetas

  const [selectedOrder, setSelectedOrder] = useState<string[]>([])
  const selectedOrderRef = useRef<string[]>([])
  selectedOrderRef.current = selectedOrder

  const [keyword, setKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<ArtistInfo[]>([])
  const [searching, setSearching] = useState(false)
  const searchSeq = useRef(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null)
  const seededRef = useRef(false)

  const simRef = useRef<Simulation<GraphSimNode, GraphSimLink<GraphSimNode>> | null>(null)
  const simNodesRef = useRef<GraphSimNode[]>([])
  const simLinksRef = useRef<GraphSimLink<GraphSimNode>[]>([])
  const nodeElRefs = useRef(new Map<string, HTMLDivElement>())
  const lineElRefs = useRef(new Map<string, SVGLineElement>())

  // 力导向仿真:整个组件生命周期只建一次,tick 时直接写 DOM(不触发 React 渲染)。
  useEffect(() => {
    const sim = createArtistGraphSimulation<GraphSimNode>([], [])
    sim.on('tick', () => {
      for (const n of simNodesRef.current) {
        n.x = clamp(n.x ?? CENTER.x, PAD, CANVAS_W - PAD)
        n.y = clamp(n.y ?? CENTER.y, PAD, CANVAS_H - PAD)
        const el = nodeElRefs.current.get(n.id)
        if (el) el.style.transform = `translate(${n.x}px, ${n.y}px)`
      }
      for (const link of simLinksRef.current) {
        const source = link.source as GraphSimNode
        const target = link.target as GraphSimNode
        const line = lineElRefs.current.get(target.id)
        if (line && typeof source.x === 'number' && typeof target.x === 'number') {
          line.setAttribute('x1', String(source.x))
          line.setAttribute('y1', String(source.y))
          line.setAttribute('x2', String(target.x))
          line.setAttribute('y2', String(target.y))
        }
      }
    })
    simRef.current = sim
    return () => { sim.stop() }
  }, [])

  useEffect(() => {
    void useRoamStore.getState().loadSuggestions(service)
  }, [service])

  // 种子节点:预置已选(编辑重开场景)+ 猜你喜欢的歌手统计结果,等 suggestions 就绪后一次性铺开——
  // 全部从画布中心的小范围抖动位置出发,交给仿真的排斥/碰撞力自己「炸开」成不重叠的松散簇。
  useEffect(() => {
    if (seededRef.current || !suggestionsLoaded) return
    seededRef.current = true
    const selectedIds = new Set(initialSelected.map((a) => String(a.id)))
    const candidates = suggestions.filter((a) => !selectedIds.has(String(a.id))).slice(0, 14)
    const all = [...initialSelected, ...candidates]
    if (all.length === 0) return

    const seedSimNodes: GraphSimNode[] = all.map((artist) => {
      const p = jitterNear(CENTER, 60)
      return { id: String(artist.id), x: p.x, y: p.y }
    })
    simNodesRef.current = seedSimNodes
    simRef.current?.nodes(simNodesRef.current)
    simRef.current?.alpha(1).restart()

    setNodeMetas(
      all.map((artist, i) => ({
        id: String(artist.id),
        artist,
        selected: selectedIds.has(String(artist.id)),
        expanded: false,
        expanding: false,
        parentId: null,
        spawnIndex: i,
      }))
    )
    setSelectedOrder(initialSelected.map((a) => String(a.id)))
    // 只在 suggestionsLoaded 首次变 true 时播种一次(靠 seededRef 守卫),initialSelected/suggestions 不必入依赖。
  }, [suggestionsLoaded])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = CENTER.x - el.clientWidth / 2
    el.scrollTop = CENTER.y - el.clientHeight / 2
  }, [])

  useEffect(() => {
    const q = keyword.trim()
    if (!q) {
      searchSeq.current++
      setSearchResults([])
      setSearching(false)
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const timer = setTimeout(() => {
      service.searchArtists(q)
        .then((list) => { if (seq === searchSeq.current) setSearchResults(list) })
        .catch(() => { if (seq === searchSeq.current) setSearchResults([]) })
        .finally(() => { if (seq === searchSeq.current) setSearching(false) })
    }, 250)
    return () => clearTimeout(timer)
  }, [keyword, service])

  /** 把一批新的相似歌手接进仿真:落在 parent 附近的小抖动位置 + 一条到 parent 的连线,重新加热仿真弹开。
   *  重新加热用较低的 alpha(0.5 而非满血 1):新节点只需要在局部弹开,没必要把全图强度拉满重新扰动一遍,
   *  加上更快的 alphaDecay,节点越滚越多时每次生长的仿真开销也不会跟着线性膨胀太多。 */
  const growChildren = useCallback((parentId: string, artists: ArtistInfo[]) => {
    const parentSim = simNodesRef.current.find((n) => n.id === parentId) ?? CENTER
    const childSimNodes: GraphSimNode[] = artists.map((artist) => {
      const p = jitterNear(parentSim, 16)
      return { id: String(artist.id), x: p.x, y: p.y }
    })
    simNodesRef.current = [...simNodesRef.current, ...childSimNodes]
    simLinksRef.current = [
      ...simLinksRef.current,
      ...childSimNodes.map((c) => ({ source: parentId, target: c.id }) as GraphSimLink<GraphSimNode>)
    ]
    if (simRef.current) {
      simRef.current.nodes(simNodesRef.current)
      getLinkForce(simRef.current).links(simLinksRef.current)
      simRef.current.alpha(0.5).restart()
    }
  }, [])

  const expandNode = useCallback(async (nodeId: string) => {
    const meta = nodeMetasRef.current.find((n) => n.id === nodeId)
    if (!meta || meta.expanded || meta.expanding || !serviceRef.current.getSimilarArtists) return
    setNodeMetas((list) => list.map((n) => (n.id === nodeId ? { ...n, expanding: true } : n)))
    try {
      const similar = await serviceRef.current.getSimilarArtists!(meta.artist.id)
      const knownIds = new Set(nodeMetasRef.current.map((n) => n.id))
      const fresh = similar.filter((a) => !knownIds.has(String(a.id))).slice(0, randomChildCount())
      growChildren(nodeId, fresh)
      setNodeMetas((list) => [
        ...list.map((n) => (n.id === nodeId ? { ...n, expanded: true, expanding: false } : n)),
        ...fresh.map((artist, i): NodeMeta => ({
          id: String(artist.id), artist, selected: false, expanded: false, expanding: false, parentId: nodeId, spawnIndex: i,
        }))
      ])
    } catch {
      setNodeMetas((list) => list.map((n) => (n.id === nodeId ? { ...n, expanding: false, expanded: true } : n)))
    }
  }, [growChildren])

  /** 点选一个已存在节点。 */
  const toggleNode = useCallback((meta: NodeMeta) => {
    if (meta.selected) {
      setSelectedOrder((order) => order.filter((id) => id !== meta.id))
      setNodeMetas((list) => list.map((n) => (n.id === meta.id ? { ...n, selected: false } : n)))
      return
    }
    if (selectedOrderRef.current.length >= MAX_ARTISTS) return
    setSelectedOrder((order) => [...order, meta.id])
    setNodeMetas((list) => list.map((n) => (n.id === meta.id ? { ...n, selected: true } : n)))
    void expandNode(meta.id)
  }, [expandNode])

  /** 搜索命中一位歌手:已在画布上就直接选中,否则先落一个新节点(在画布中心附近)再选中+生长。 */
  const pickFromSearch = useCallback((artist: ArtistInfo) => {
    const id = String(artist.id)
    const existing = nodeMetasRef.current.find((n) => n.id === id)
    if (existing) {
      toggleNode(existing)
    } else {
      if (selectedOrderRef.current.length >= MAX_ARTISTS) return
      const p = jitterNear(CENTER, 80)
      simNodesRef.current = [...simNodesRef.current, { id, x: p.x, y: p.y }]
      simRef.current?.nodes(simNodesRef.current)
      simRef.current?.alpha(0.5).restart()

      const meta: NodeMeta = { id, artist, selected: true, expanded: false, expanding: false, parentId: null, spawnIndex: 0 }
      setNodeMetas((list) => [...list, meta])
      setSelectedOrder((order) => [...order, id])
      void expandNode(id)
    }
    setKeyword('')
    setSearchResults([])
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.scrollIntoView({
        behavior: 'smooth', block: 'center', inline: 'center'
      })
    })
  }, [toggleNode, expandNode])

  // 拖拽平移画布:必须 preventDefault + 配合 CSS user-select:none(见 module.css .overlay),
  // 否则鼠标在密密麻麻的头像图片上按住拖动会触发浏览器原生的图片/文字拖拽选中,
  // 出现整屏头像被"全选"高亮的视觉 bug,拖动时还要为选区重绘,越拖越卡。
  const onPointerDownCanvas = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input')) return
    e.preventDefault()
    const el = e.currentTarget
    dragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }, [])
  const onPointerMoveCanvas = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const el = e.currentTarget
    el.scrollLeft = dragRef.current.scrollLeft - (e.clientX - dragRef.current.startX)
    el.scrollTop = dragRef.current.scrollTop - (e.clientY - dragRef.current.startY)
  }, [])
  const onPointerUpCanvas = useCallback(() => {
    dragRef.current = null
  }, [])

  function confirm() {
    const artists = selectedOrder
      .map((id) => nodeMetas.find((n) => n.id === id)?.artist)
      .filter((a): a is ArtistInfo => !!a)
    if (artists.length === 0) return
    onConfirm(artists)
  }

  const registerNodeEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (!el) {
      nodeElRefs.current.delete(id)
      return
    }
    nodeElRefs.current.set(id, el)
    const n = simNodesRef.current.find((n) => n.id === id)
    if (n && typeof n.x === 'number') el.style.transform = `translate(${n.x}px, ${n.y}px)`
  }, [])

  const registerLineEl = useCallback((childId: string, el: SVGLineElement | null) => {
    if (!el) {
      lineElRefs.current.delete(childId)
      return
    }
    lineElRefs.current.set(childId, el)
    const link = simLinksRef.current.find((l) => (l.target as GraphSimNode).id === childId)
    if (link) {
      const source = link.source as GraphSimNode
      const target = link.target as GraphSimNode
      if (typeof source.x === 'number' && typeof target.x === 'number') {
        el.setAttribute('x1', String(source.x))
        el.setAttribute('y1', String(source.y))
        el.setAttribute('x2', String(target.x))
        el.setAttribute('y2', String(target.y))
      }
    }
  }, [])

  const selectedArtists = selectedOrder
    .map((id) => nodeMetas.find((n) => n.id === id))
    .filter((n): n is NodeMeta => !!n)
  const atCap = selectedOrder.length >= MAX_ARTISTS

  // 传送到 document.body:RoamPage 挂在 AppShell 的页面转场 motion.div 里(scale/x/y 动画用 transform
  // 实现),transform 会给 position:fixed 后代新建包含块,z-index 只在该祖先的局部层叠上下文里比较——
  // 实测踩过坑,不传送的话哪怕 z-index 拉到 300 也会被 App.tsx 里同级挂载、z-index 210 的播放栏挡住点击。
  return createPortal(
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={springGentle}
    >
      <div className={styles.header}>
        <button className={`${styles.closeBtn} no-drag`} onClick={onClose} aria-label="关闭选歌手">
          <CloseIcon size={16} />
        </button>
        <h2 className={styles.title}>选择歌手</h2>
        <div className={styles.searchWrap}>
          <input
            className={`${styles.searchInput} no-drag`}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索歌手…"
          />
          {(searching || searchResults.length > 0) && (
            <div className={styles.searchDropdown}>
              {searching && <p className={styles.hint}>搜索中…</p>}
              {!searching && searchResults.map((artist, i) => (
                <button
                  key={`${artist.source}-${String(artist.id)}-${i}`}
                  className={`${styles.searchRow} no-drag`}
                  onClick={() => pickFromSearch(artist)}
                >
                  {artist.avatar && <img className={styles.searchAvatar} src={artist.avatar} alt="" loading="lazy" draggable={false} />}
                  <span>{artist.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className={styles.canvasScroll}
        onPointerDown={onPointerDownCanvas}
        onPointerMove={onPointerMoveCanvas}
        onPointerUp={onPointerUpCanvas}
        onPointerCancel={onPointerUpCanvas}
      >
        <div className={styles.canvasInner} style={{ width: CANVAS_W, height: CANVAS_H }}>
          <svg className={styles.edgeLayer} width={CANVAS_W} height={CANVAS_H}>
            {nodeMetas.filter((n) => n.parentId).map((n) => (
              <line
                key={n.id}
                ref={(el) => registerLineEl(n.id, el)}
                stroke="var(--sm-border-strong)" strokeWidth={1.5}
              />
            ))}
          </svg>

          {nodeMetas.length === 0 && suggestionsLoaded && (
            <p className={styles.emptyHint} style={{ left: CENTER.x, top: CENTER.y }}>
              搜索一位歌手开始选择
            </p>
          )}

          {nodeMetas.map((meta) => (
            <div
              key={meta.id}
              ref={(el) => registerNodeEl(meta.id, el)}
              className={styles.node}
              data-node-id={meta.id}
            >
              <div className={styles.nodeCenter}>
                <ArtistGraphNodeContent meta={meta} disabled={!meta.selected && atCap} onToggle={toggleNode} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.dock}>
        <div className={styles.dockList}>
          {selectedArtists.length === 0 && <span className={styles.dockHint}>还没选歌手</span>}
          {selectedArtists.map((n) => (
            <span key={n.id} className={styles.dockChip}>
              {n.artist.avatar && <img className={styles.dockAvatar} src={n.artist.avatar} alt="" loading="lazy" draggable={false} />}
              {n.artist.name}
              <button
                className={`${styles.dockRemove} no-drag`}
                onClick={() => toggleNode(n)}
                aria-label={`移除 ${n.artist.name}`}
              >
                <CloseIcon size={11} />
              </button>
            </span>
          ))}
        </div>
        <motion.button
          className={`${styles.confirmBtn} no-drag`}
          disabled={selectedArtists.length === 0}
          onClick={confirm}
          whileTap={tapScale}
          transition={springSnappy}
        >
          确认,共 {selectedArtists.length} 位 →
        </motion.button>
      </div>
    </motion.div>,
    document.body
  )
}
