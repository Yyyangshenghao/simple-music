import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { useTaskCenterStore } from '../../stores/task-center'
import { useKaraokeStore } from '../../stores/karaoke'
import { useToastStore } from '../../stores/toast'
import { accompanimentId, accompanimentOriginal, accompanimentsForTrack, findAccompaniment } from '../../lib/karaoke-library'
import { useSettingsStore } from '../../stores/settings'
import { sameKaraokeTrack } from '../../types/karaoke'
import { tapScale, springSnappy, popoverSprout } from '../../lib/motion-presets'
import { sproutPath } from './sprout-shape'
import { useMotion } from '../../hooks/useMotion'
import styles from './PlayerBar.module.css'
import panelStyles from './AccompanimentPanel.module.css'
import { AccompanimentPanel } from './AccompanimentPanel'

/** 长按多久打开弹窗；进度环晚一点出现，普通点按不会闪出圆环。 */
const HOLD_MS = 450
const HOLD_RING_DELAY = 120
/** 浮层底部包住麦克风的圆：半径、圆心低于面板底边的距离、与面板之间过渡段的宽度 */
const BUBBLE = 22
const SINK = 14
const FILLET = 10
/** 与面板样式的圆角一致 */
const PANEL_RADIUS = 20
/** 浮层与窗口边缘的最小距离 */
const EDGE = 12

/** 本次打开的三态外形（缩成麦克风中心的点、包住麦克风的圆、完整面板）与进行中的长出动画；closing 防止重复收回。 */
interface Sprout { gone: string; closed: string; open: string; closing: boolean; growing?: Animation[] }
/** 长出时圆先从麦克风中心鼓起，占全程的这一段；收回时最后这一段缩回中心 */
const BUBBLE_PHASE = 0.25

export function AccompanimentButton() {
  const track = usePlayerStore(s => s.currentTrack)
  const accompaniment = usePlayerStore(s => s.accompaniment)
  const items = useKaraokeStore(s => s.items)
  const jobs = useKaraokeStore(s => s.jobs)
  const played = useKaraokeStore(s => s.played)
  const model = useSettingsStore(s => s.karaokeModel)
  const [open, setOpen] = useState(false)
  // 后台生成完成且面板未打开时，按钮上留一个小圆点，打开面板后清除。
  const [fresh, setFresh] = useState(false)
  const animated = useMotion('popoverSproutMotion')
  const trackKey = track ? `${track.source}:${String(track.id)}` : ''
  const original = track ? accompanimentOriginal(track) ?? track : null
  // 在原曲与“我的伴奏”条目之间切换会换当前曲目，但仍是同一首歌，弹窗保持打开。
  const songKey = original ? `${original.source}:${String(original.id)}` : ''
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const outline = useRef<SVGPathElement>(null)
  /** 本次打开的裁切圆：外圈与铺满两档，收回时复用；closing 防止重复收回。 */
  const sprout = useRef<Sprout | null>(null)
  const tasks = original ? jobs.filter(job => sameKaraokeTrack(job.track, original)) : []
  const task = tasks.find(job => !['queued', 'waiting-memory', 'failed'].includes(job.phase))
    ?? tasks.find(job => job.phase !== 'failed') ?? tasks[0]
  const job = task?.phase !== 'failed' ? task : undefined
  const playable = track && track.source !== 'apple' ? accompanimentsForTrack(track, items).filter(item => item.available) : []
  const ready = playable.length
  // 点按在原唱与最近播放过的伴奏之间切换（没播放过则按所选模型、最新生成）；长按或右键打开完整弹窗。
  const preferred = track && ready ? findAccompaniment(track, items, model, played) : null
  const [holding, setHolding] = useState(false)
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean; busy: boolean }>({ fired: false, busy: false })
  // 生成期间记下已有成品数；任务结束后成品变多即视为完成（任务移除与成品入库的先后不定）。
  const baseline = useRef<number | null>(null)
  useEffect(() => {
    clearTimeout(hold.current.timer)
    hold.current.fired = false
    setHolding(false)
    setOpen(false)
    setFresh(false)
    baseline.current = null
  }, [songKey])
  // 布局阶段定位并先按收起态裁切，首帧就只露出麦克风外的圆，不会整块闪现。
  useLayoutEffect(() => {
    if (!open) return
    sprout.current = null
    // 浮层挂在 body 上以保留玻璃模糊（播放栏自身也是玻璃，嵌在里面的模糊取不到页面内容），位置跟随麦克风按钮。
    const place = () => {
      // 面板水平居中于麦克风并收在窗口内，底部的圆套住麦克风（底部播放栏与歌词页内嵌播放栏通用）。
      const anchor = root.current?.getBoundingClientRect()
      const el = panel.current
      const dialog = surface.current?.querySelector<HTMLElement>('[role="dialog"]')
      if (!anchor || !el || !dialog || !surface.current) return
      const width = el.offsetWidth
      const center = anchor.left + anchor.width / 2
      const middle = anchor.top + anchor.height / 2
      const left = Math.min(Math.max(EDGE, center - width / 2), window.innerWidth - EDGE - width)
      el.style.left = `${left}px`
      el.style.bottom = `${window.innerHeight - middle - BUBBLE}px`
      el.style.setProperty('--mic-x', `${center - left}px`)
      el.style.setProperty('--popover-max', `${Math.max(240, middle - SINK - EDGE)}px`)
      // 圆里画一份同色的麦克风：玻璃会模糊下面真正的按钮，点击仍穿透到按钮。
      const button = root.current?.querySelector('button')
      if (button) el.style.setProperty('--mic-color', getComputedStyle(button).color)
      const geometry = { width, height: dialog.offsetHeight, radius: PANEL_RADIUS, cx: center - left, bubble: BUBBLE, sink: SINK, fillet: FILLET }
      const shape = { gone: sproutPath({ ...geometry, bubble: 0 }, false), closed: sproutPath(geometry, false), open: sproutPath(geometry, true) }
      surface.current.style.clipPath = `path('${shape.open}')`
      outline.current?.setAttribute('d', shape.open)
      // 长出途中面板变高（如模型列表晚到）时换成新外形的关键帧，并保留已走的进度，圆始终对准麦克风。
      const growing = sprout.current?.growing?.filter(animation => animation.playState === 'running')
      let next: Animation[] | undefined
      if (growing?.length) {
        const elapsed = growing[0].currentTime
        for (const animation of growing) animation.cancel()
        next = grow(shape)
        for (const animation of next) animation.currentTime = elapsed
      }
      sprout.current = { ...shape, closing: sprout.current?.closing ?? false, growing: next }
    }
    place()
    const geometry = sprout.current as Sprout | null
    // 先只有麦克风外的圆，圆的上半部向上展开成整块面板；玻璃与描边同一组关键帧。
    if (geometry && animated) geometry.growing = grow(geometry)
    // 面板内容变化（如出现人声保留）时按新高度重算外形
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (!sprout.current?.closing) place() })
    const dialog = surface.current?.querySelector('[role="dialog"]')
    if (dialog) resize?.observe(dialog)
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !surface.current?.querySelector('[role="dialog"]')?.contains(target)) close()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('resize', place)
    window.addEventListener('pointerdown', outside)
    // 全局按键守卫在捕获阶段拦截后续传播，Esc 也需在捕获阶段监听。
    window.addEventListener('keydown', escape, true)
    return () => {
      resize?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open])
  /**
   * 玻璃外形与描边按同一组关键帧变形
   *
   * @param frames 每帧给玻璃与描边各一个 path() 值；offset 缺省时均分
   */
  function morph(frames: { surface: string; outline: string; offset?: number }[], timing: KeyframeAnimationOptions): Animation[] {
    return [
      surface.current?.animate(frames.map(({ surface: clipPath, offset }) => ({ clipPath, offset })), timing),
      outline.current?.animate(frames.map(({ outline: d, offset }) => ({ d, offset })), timing),
    ].filter((animation): animation is Animation => !!animation)
  }
  const frame = (path: string, offset?: number) => ({ surface: `path('${path}')`, outline: `path('${path}')`, offset })
  /** 圆先从麦克风中心鼓起，圆的上部再向上展开成整块面板。 */
  function grow(shape: Pick<Sprout, 'gone' | 'closed' | 'open'>): Animation[] {
    return morph([frame(shape.gone), frame(shape.closed, BUBBLE_PHASE), frame(shape.open)], popoverSprout.grow)
  }
  /** 收回成包住麦克风的圆，再缩进麦克风中心后卸载，不留残圈；无动效时直接关闭。 */
  function close() {
    const geometry = sprout.current
    const el = surface.current
    if (!animated || !geometry || !el) { setOpen(false); return }
    if (geometry.closing) return
    geometry.closing = true
    // 停在缩没的状态直到卸载；窗口隐藏时动画可能不推进，定时兜底关闭。
    const done = () => {
      clearTimeout(fallback)
      el.style.clipPath = `path('${geometry.gone}')`
      outline.current?.setAttribute('d', geometry.gone)
      setOpen(false)
    }
    const fallback = setTimeout(done, popoverSprout.retract.duration + 200)
    // 从屏幕上的当前外形出发（长出途中关闭也不会先跳回完整面板）。
    const shown = (value: string | null | undefined) => value?.startsWith('path(') ? value : `path('${geometry.open}')`
    const current = { surface: shown(getComputedStyle(el).clipPath), outline: shown(outline.current && getComputedStyle(outline.current).getPropertyValue('d')) }
    for (const animation of geometry.growing ?? []) animation.cancel()
    const [retract] = morph([{ ...current }, frame(geometry.closed, 1 - BUBBLE_PHASE), frame(geometry.gone)], { ...popoverSprout.retract, fill: 'forwards' })
    if (retract) retract.finished.then(done, done)
    else done()
  }
  useEffect(() => {
    if (job) { baseline.current = Math.min(baseline.current ?? ready, ready); return }
    if (baseline.current !== null && ready > baseline.current) { baseline.current = null; if (!open) setFresh(true) }
  }, [job, ready, open])
  useEffect(() => { if (open) setFresh(false) }, [open])
  useEffect(() => () => clearTimeout(hold.current.timer), [])
  const usingStem = !!track && !!accompanimentId(accompaniment ?? track)
  const endHold = () => { clearTimeout(hold.current.timer); setHolding(false) }
  const startHold = (event: PointerEvent<HTMLButtonElement>) => {
    if (!track || track.source === 'apple' || event.button !== 0) return
    clearTimeout(hold.current.timer)
    hold.current.fired = false
    setHolding(true)
    hold.current.timer = setTimeout(() => { hold.current.fired = true; setHolding(false); setOpen(true) }, HOLD_MS)
  }
  async function toggle() {
    if (!track || !preferred || hold.current.busy) return
    hold.current.busy = true
    setFresh(false)
    try { await usePlayerStore.getState().selectAccompaniment(usingStem ? null : preferred.id, `${track.source}:${String(track.id)}`) }
    catch (error) { useToastStore.getState().show(error instanceof Error ? error.message : '切换失败，请重试') }
    finally { hold.current.busy = false }
  }
  function click() {
    // 长按已打开弹窗时，松手产生的 click 不再切换。
    if (hold.current.fired) { hold.current.fired = false; return }
    if (preferred) void toggle()
    else if (task) { if (open) close(); useTaskCenterStore.getState().show('karaoke', `k:${task.id}`) }
    else if (open) close()
    else setOpen(true)
  }
  const active = !!accompaniment || !!(track && accompanimentOriginal(track))
  const tip = !track ? '请先播放歌曲'
    : track.source === 'apple' ? 'Apple Music 暂不支持伴奏模式'
    : task && !preferred ? `${task.phase === 'failed' ? '生成失败' : '正在生成伴奏'}，点按查看任务队列 · 长按管理`
    : preferred ? `${usingStem ? '切回原唱' : fresh ? '伴奏已生成，点按切换' : '切换到伴奏'} · 长按管理`
    : '选择或生成伴奏版本'

  return <div className={panelStyles.root} ref={root}>
    <motion.button
    type="button"
    className={`${styles.btn} ${styles.accompanimentBtn} no-drag`}
    data-active={active}
    data-busy={!!job}
    data-tip={tip}
    aria-label="伴奏模式"
    aria-pressed={active}
    aria-haspopup="dialog"
    aria-expanded={open}
    disabled={!track || track.source === 'apple'}
    onClick={click}
    onPointerDown={startHold}
    onPointerUp={endHold}
    onPointerLeave={endHold}
    onPointerCancel={endHold}
    onContextMenu={event => { event.preventDefault(); endHold(); setOpen(true) }}
    whileTap={tapScale}
    transition={springSnappy}
  >
    <MicIcon active={active} />
    {holding && <svg className={styles.accompanimentHold} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" pathLength="100" transform="rotate(-90 16 16)" style={{ animationDuration: `${HOLD_MS - HOLD_RING_DELAY}ms`, animationDelay: `${HOLD_RING_DELAY}ms` }} />
    </svg>}
    {fresh && !job && <span className={styles.accompanimentDot} aria-hidden="true" />}
    </motion.button>
    {typeof document !== 'undefined' && createPortal(<AnimatePresence>{open && track && <motion.div key={songKey} ref={panel} className={`${panelStyles.popover} no-drag`}
      exit={{ opacity: 0 }} transition={animated ? { duration: 0.12 } : { duration: 0 }}>
      <div ref={surface} className={panelStyles.surface}>
        <AccompanimentPanel track={track} onClose={close} />
        <span className={panelStyles.micCopy} aria-hidden="true"><MicIcon active={active} /></span>
      </div>
      <svg className={panelStyles.outline} aria-hidden="true">
        <defs><linearGradient id="accompaniment-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255, 255, 255, 0.5)" /><stop offset="0.45" stopColor="rgba(255, 255, 255, 0.06)" /><stop offset="1" stopColor="rgba(255, 255, 255, 0.2)" />
        </linearGradient></defs>
        <path ref={outline} stroke="url(#accompaniment-edge)" />
      </svg>
    </motion.div>}</AnimatePresence>, document.body)}
  </div>
}

/** 麦克风图标：与右侧工具图标同一 24 网格、17px、1.8 描边；使用伴奏时话筒头实心。 */
function MicIcon({ active }: { active: boolean }) {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="15" cy="9" r="5.6" fill={active ? 'currentColor' : 'none'} />
    <path d="M11 13 4 19.1a1.2 1.2 0 0 0-.06 1.75l.21.21a1.2 1.2 0 0 0 1.75-.06L12 14" />
    {!active && <path d="m11.1 5.1 7.8 7.8" />}
  </svg>
}
