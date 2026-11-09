import { LayoutGroup, motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useMotion } from '../../hooks/useMotion'
import { useSystemReducedMotion } from '../../hooks/useSystemReducedMotion'
import { springSnappy } from '../../lib/motion-presets'
import { applyModeDrop, QISHUI_MAX_PINNED_MODES, type ModeDropTarget } from '../../lib/qishui-mode-pins'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from '../../lib/provider-request-cache'
import { getQishuiListeningModes, getQishuiListeningTracks, prepareQishuiListening, type QishuiListeningMode } from '../../lib/qishui-music-service'
import { qishuiRadioContext, qishuiRadioMode } from '../../lib/qishui-radio'
import { usePlayerStore } from '../../stores/player'
import { usePlaylistStore } from '../../stores/playlist'
import { isProviderParticipating, useProviderStore } from '../../stores/providers'
import { useSettingsStore } from '../../stores/settings'
import { ActionButton } from '../ui/ActionButton'
import { EqIndicator } from '../ui/EqIndicator'
import styles from './PersonalListeningSection.module.css'
import modeStyles from './QishuiListeningModes.module.css'

const DRAG_THRESHOLD_PX = 5
const ROW_HIT_MARGIN_PX = 14
const TRAY_WIDTH_PX = 440
const TRAY_HEIGHT_PX = 340
const VIEWPORT_MARGIN_PX = 12

function useListeningModes() {
  const scope = 'explore:listening-modes'
  const [data, setData] = useState(() => getCachedProviderData<QishuiListeningMode[]>('qishui', scope))
  const [busy, setBusy] = useState(data === undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const isCurrent = () => !cancelled && isProviderParticipating('qishui')
    void requestProviderData('qishui', scope, getQishuiListeningModes, { force: attempt > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(items => { if (isCurrent()) setData(items) })
      .catch(() => { if (isCurrent()) setFailed(true) })
      .finally(() => { if (isCurrent()) setBusy(false) })
    return () => { cancelled = true }
  }, [attempt])

  function refresh() {
    if (busy || !isProviderParticipating('qishui')) return
    setFailed(false)
    setBusy(true)
    setAttempt(value => value + 1)
  }

  return { data, busy, failed, refresh }
}

const modeGlyphs: Record<string, string> = {
  default: 'M3 12h3l2-5 3 10 3-12 3 7h4',
  familiar: 'M3 11a9 9 0 1 1 2.6 7.4M3 6v5h5m4-4v5l3 2',
  fresh: 'M12 3l2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1L12 3Z',
  more: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  music: 'M10 17V6l10-2v11M10 17c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Zm10-2c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Z',
}

function ModeIcon({ mode }: { mode: Pick<QishuiListeningMode, 'id' | 'icon'> }) {
  const [failedIcon, setFailedIcon] = useState<string>()
  return mode.icon && mode.icon !== failedIcon
    ? <img src={mode.icon} alt="" draggable={false} loading="lazy" onError={() => setFailedIcon(mode.icon)} />
    : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round"><path d={modeGlyphs[mode.id] ?? modeGlyphs.music} /></svg>
}

type TileState = 'idle' | 'starting' | 'playing' | 'paused'

function TileIcon({ mode, state }: { mode: QishuiListeningMode; state: TileState }) {
  return <span className={modeStyles.icon} aria-hidden="true">
    {state === 'starting' ? <span className={modeStyles.spinner} />
      : state === 'playing' || state === 'paused' ? <EqIndicator paused={state === 'paused'} />
      : <>
        <span className={modeStyles.glyph}><ModeIcon mode={mode} /></span>
        <svg className={modeStyles.playGlyph} width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.2v9.6a.5.5 0 0 0 .77.42l7.4-4.8a.5.5 0 0 0 0-.84l-7.4-4.8A.5.5 0 0 0 5 3.2Z" /></svg>
      </>}
  </span>
}

interface DragState {
  id: string
  from: 'row' | 'tray'
  target: ModeDropTarget
}

/** 指针拖动：越过阈值才算拖动，否则保留为普通点击；Esc 或落在两区之外都不改变常用区。 */
function useModeDrag({ pins, rowRef, trayRef, onDrop, onStart }: {
  pins: string[]
  rowRef: RefObject<HTMLDivElement>
  trayRef: RefObject<HTMLDivElement>
  onDrop(id: string, target: ModeDropTarget): void
  onStart(from: 'row' | 'tray'): void
}) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const suppressClick = useRef(false)
  const stopRef = useRef<(() => void) | null>(null)
  const latest = useRef({ pins, onDrop, onStart })
  latest.current = { pins, onDrop, onStart }

  useEffect(() => () => stopRef.current?.(), [])

  useLayoutEffect(() => {
    if (drag && ghostRef.current) ghostRef.current.style.transform = `translate3d(${pointer.current.x}px, ${pointer.current.y}px, 0) translate(-50%, -50%)`
  }, [drag !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const begin = useCallback((event: ReactPointerEvent, id: string, from: 'row' | 'tray') => {
    if (event.button !== 0) return
    suppressClick.current = false
    const startX = event.clientX
    const startY = event.clientY
    let active = false

    const targetAt = (x: number, y: number): ModeDropTarget => {
      const row = rowRef.current?.getBoundingClientRect()
      if (row && x >= row.left - ROW_HIT_MARGIN_PX && x <= row.right + ROW_HIT_MARGIN_PX && y >= row.top - ROW_HIT_MARGIN_PX && y <= row.bottom + ROW_HIT_MARGIN_PX) {
        const tiles = [...rowRef.current!.querySelectorAll<HTMLElement>('[data-mode-tile]')]
        let index = tiles.length
        let nearest = Infinity
        tiles.forEach((tile, position) => {
          const rect = tile.getBoundingClientRect()
          const distance = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2))
          if (distance < nearest) {
            nearest = distance
            index = position
          }
        })
        return { zone: 'row', index }
      }
      const tray = trayRef.current?.getBoundingClientRect()
      return tray && x >= tray.left && x <= tray.right && y >= tray.top && y <= tray.bottom ? { zone: 'tray' } : null
    }

    const sameTarget = (a: ModeDropTarget, b: ModeDropTarget) => a?.zone === b?.zone
      && (a?.zone !== 'row' || b?.zone !== 'row' || a.index === b.index)

    const move = (moved: PointerEvent) => {
      pointer.current = { x: moved.clientX, y: moved.clientY }
      if (!active) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD_PX) return
        active = true
        suppressClick.current = true
        document.body.style.setProperty('user-select', 'none')
        latest.current.onStart(from)
        setDrag({ id, from, target: from === 'row' ? { zone: 'row', index: latest.current.pins.indexOf(id) } : { zone: 'tray' } })
      }
      if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${moved.clientX}px, ${moved.clientY}px, 0) translate(-50%, -50%)`
      const target = targetAt(moved.clientX, moved.clientY)
      setDrag(current => current && !sameTarget(current.target, target) ? { ...current, target } : current)
    }

    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      document.body.style.removeProperty('user-select')
      stopRef.current = null
    }
    const up = (ended: PointerEvent) => {
      stop()
      if (!active) return
      latest.current.onDrop(id, targetAt(ended.clientX, ended.clientY))
      setDrag(null)
    }
    const cancel = () => {
      stop()
      if (active) latest.current.onDrop(id, null)
      setDrag(null)
    }
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key !== 'Escape' || !active) return
      pressed.preventDefault()
      pressed.stopPropagation()
      cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    stopRef.current = stop
  }, [rowRef, trayRef])

  /** 拖动结束后浏览器还会补一次 click，不能让它触发播放。 */
  const consumeClick = useCallback(() => {
    const suppressed = suppressClick.current
    suppressClick.current = false
    return suppressed
  }, [])

  return { drag, ghostRef, begin, consumeClick }
}

function useTrayPosition(open: boolean, anchorRef: RefObject<HTMLButtonElement>) {
  const [style, setStyle] = useState<CSSProperties>()
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      if (!anchor) return
      const width = Math.min(TRAY_WIDTH_PX, window.innerWidth - VIEWPORT_MARGIN_PX * 2)
      const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(anchor.right - width, window.innerWidth - width - VIEWPORT_MARGIN_PX))
      const roomBelow = window.innerHeight - anchor.bottom
      setStyle(roomBelow >= TRAY_HEIGHT_PX || anchor.top < roomBelow
        ? { left, width, top: anchor.bottom + 8 }
        : { left, width, bottom: window.innerHeight - anchor.top + 8 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchorRef])
  return style
}

function ListeningModesContent() {
  const { data: modes, busy, failed, refresh } = useListeningModes()
  const savedPins = useSettingsStore(state => state.qishuiPinnedModes)
  const setPins = useSettingsStore(state => state.setQishuiPinnedModes)
  const playing = qishuiRadioMode(usePlaylistStore(state => state.queueContextId))
  const isPlaying = usePlayerStore(state => state.status === 'playing')
  const [starting, setStarting] = useState<string | null>(null)
  const [startFailed, setStartFailed] = useState(false)
  const [trayOpen, setTrayOpen] = useState(false)
  const [query, setQuery] = useState('')
  const attempt = useRef(0)
  const rowRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const openedByDrag = useRef(false)
  const dragMotion = useMotion('dragMotion')
  const indicatorMotion = useMotion('indicatorMotion')
  const reducedMotion = useSystemReducedMotion()

  const byId = useMemo(() => new Map((modes ?? []).map(mode => [mode.id, mode])), [modes])
  const pins = useMemo(() => savedPins.filter(id => byId.has(id)), [savedPins, byId])

  const onStart = useCallback((from: 'row' | 'tray') => {
    if (from === 'row') {
      openedByDrag.current = true
      setTrayOpen(true)
    }
  }, [])
  const onDrop = useCallback((id: string, target: ModeDropTarget) => {
    setPins(applyModeDrop(useSettingsStore.getState().qishuiPinnedModes.filter(item => byId.has(item)), id, target))
    if (openedByDrag.current) {
      openedByDrag.current = false
      setTrayOpen(false)
    }
  }, [byId, setPins])
  const { drag, ghostRef, begin, consumeClick } = useModeDrag({ pins, rowRef, trayRef, onDrop, onStart })

  // 拖动时实时预览落点，松手前就能看到结果。
  const shownPins = useMemo(() => drag ? applyModeDrop(pins, drag.id, drag.target) : pins, [drag, pins])
  const overflow = useMemo(() => (modes ?? []).filter(mode => !shownPins.includes(mode.id)), [modes, shownPins])
  const keyword = query.trim().toLowerCase()
  const visibleOverflow = overflow.filter(mode => mode.label.toLowerCase().includes(keyword))
  const trayStyle = useTrayPosition(trayOpen, moreRef)

  const pinKey = pins.join()
  useEffect(() => {
    if (!modes) return
    for (const id of pinKey ? pinKey.split(',') : []) prepareQishuiListening(id)
  }, [modes, pinKey])

  useEffect(() => {
    if (!trayOpen || drag) return
    const outside = (event: PointerEvent) => {
      const node = event.target as Node
      if (!trayRef.current?.contains(node) && !moreRef.current?.contains(node)) setTrayOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) setTrayOpen(false)
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [trayOpen, drag])

  useEffect(() => { if (!trayOpen) setQuery('') }, [trayOpen])

  async function start(id: string) {
    if (consumeClick()) return
    setTrayOpen(false)
    if (id === starting) return
    const mine = ++attempt.current
    if (id === playing) {
      setStarting(null)
      setStartFailed(false)
      usePlayerStore.getState().toggle()
      return
    }
    setStarting(id)
    setStartFailed(false)
    try {
      const tracks = await getQishuiListeningTracks(id, true)
      if (mine !== attempt.current || !isProviderParticipating('qishui')) return
      if (!tracks.length) throw new Error('EMPTY')
      usePlaylistStore.getState().setQueue(tracks, 0, qishuiRadioContext(id))
    } catch {
      if (mine === attempt.current) setStartFailed(true)
    } finally {
      if (mine === attempt.current) setStarting(null)
    }
  }

  // 点下立即切换选中态，不等网络返回。
  const selected = starting ?? (startFailed ? null : playing)
  const stateOf = (id: string): TileState => id === starting ? 'starting'
    : id !== selected ? 'idle'
    : isPlaying ? 'playing' : 'paused'
  const selectedLabel = selected ? byId.get(selected)?.label : undefined
  const selectedInTray = !!selected && !shownPins.includes(selected)

  // 状态固定占这一行，切换时页面不跳动。
  const caption = startFailed ? '选曲失败，再点一次重试'
    : starting ? `正在切换到${selectedLabel ?? '听歌模式'}`
    : selectedLabel ? `${isPlaying ? '正在连续播放' : '已暂停'}：${selectedLabel}`
    : '点一下开始播放，拖动可调整常用模式'

  const draggedMode = drag ? byId.get(drag.id) : undefined
  const layout = dragMotion && !reducedMotion ? 'position' as const : false
  const indicatorTransition = indicatorMotion && !reducedMotion ? springSnappy : { duration: 0 }

  return <section className={styles.section} aria-label="汽水听歌模式">
    <header className={styles.header}>
      <div><h3>听歌模式</h3><p className={`${styles.caption} ${startFailed ? modeStyles.captionFailed : ''}`} role="status">{caption}</p></div>
    </header>
    {modes && <LayoutGroup id="qishui-listening-modes">
      <div ref={rowRef} className={modeStyles.row} role="group" aria-label="常用听歌模式" data-dragging={!!drag || undefined}>
        {shownPins.map(id => {
          const mode = byId.get(id)
          if (!mode) return null
          const state = stateOf(id)
          return <motion.button key={id} type="button" layout={layout} transition={springSnappy} data-mode-tile
            className={`${modeStyles.tile} no-drag`} aria-pressed={id === selected} aria-busy={state === 'starting'}
            data-state={state} data-placeholder={drag?.id === id || undefined}
            onPointerDown={event => begin(event, id, 'row')} onPointerEnter={() => prepareQishuiListening(id)}
            onClick={() => void start(id)}>
            {id === selected && <motion.span layoutId="qishui-mode-indicator" className={modeStyles.indicator} transition={indicatorTransition} />}
            <TileIcon mode={mode} state={state} />
            <span className={modeStyles.label}>{mode.label}</span>
          </motion.button>
        })}
        {drag && shownPins.length < QISHUI_MAX_PINNED_MODES && <span className={modeStyles.emptySlot} aria-hidden="true" />}
        <button ref={moreRef} type="button" className={`${modeStyles.tile} ${modeStyles.more} no-drag`}
          aria-expanded={trayOpen} aria-pressed={selectedInTray} data-state={selectedInTray && selected ? stateOf(selected) : 'idle'}
          onClick={() => {
            openedByDrag.current = false
            setTrayOpen(open => !open)
          }}>
          {selectedInTray && <motion.span layoutId="qishui-mode-indicator" className={modeStyles.indicator} transition={indicatorTransition} />}
          <span className={modeStyles.icon} aria-hidden="true">
            {selectedInTray && selected === starting ? <span className={modeStyles.spinner} />
              : selectedInTray ? <EqIndicator paused={!isPlaying} />
              : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={modeGlyphs.more} /></svg>}
          </span>
          <span className={modeStyles.label}>{selectedInTray ? selectedLabel : '更多模式'}</span>
          <svg className={modeStyles.chevron} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </button>
      </div>
    </LayoutGroup>}
    {busy && !modes && <p className={styles.status} role="status">正在读取听歌模式…</p>}
    {failed && <div className={styles.error} role="status">
      <span>听歌模式暂时无法加载</span>
      <ActionButton label="重试" compact onClick={refresh} />
    </div>}
    {trayOpen && modes && createPortal(<div ref={trayRef} className={`${modeStyles.tray} no-drag`} style={trayStyle}
      role="group" aria-label="更多听歌模式" data-drop-active={drag?.target?.zone === 'tray' && drag.from === 'row' || undefined}>
      <div className={modeStyles.trayHeader}>
        <p>拖到上方固定，最多 {QISHUI_MAX_PINNED_MODES} 个</p>
        <input className={modeStyles.search} type="search" aria-label="搜索模式" placeholder="搜索"
          value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      {visibleOverflow.length > 0 ? <div className={modeStyles.trayGrid}>
        {visibleOverflow.map(mode => {
          const state = stateOf(mode.id)
          return <button key={mode.id} type="button" className={modeStyles.chip} aria-pressed={mode.id === selected}
            aria-busy={state === 'starting'} data-placeholder={drag?.id === mode.id || undefined}
            onPointerDown={event => begin(event, mode.id, 'tray')} onPointerEnter={() => prepareQishuiListening(mode.id)}
            onClick={() => void start(mode.id)}>
            <TileIcon mode={mode} state={state} />
            <span className={modeStyles.label}>{mode.label}</span>
          </button>
        })}
      </div> : <p className={modeStyles.trayEmpty} role="status">{keyword ? '未找到匹配的模式' : '全部模式都已固定'}</p>}
    </div>, document.body)}
    {drag && draggedMode && createPortal(<div ref={ghostRef} className={modeStyles.ghost} aria-hidden="true">
      <span className={modeStyles.icon}><span className={modeStyles.glyph}><ModeIcon mode={draggedMode} /></span></span>
      <span className={modeStyles.label}>{draggedMode.label}</span>
    </div>, document.body)}
  </section>
}

export function QishuiListeningModes() {
  const enabled = useProviderStore(() => isProviderParticipating('qishui'))
  return enabled ? <ListeningModesContent /> : null
}
