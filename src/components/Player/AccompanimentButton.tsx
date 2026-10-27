import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { useKaraokeStore } from '../../stores/karaoke'
import { useToastStore } from '../../stores/toast'
import { accompanimentId, accompanimentOriginal, accompanimentsForTrack, findAccompaniment } from '../../lib/karaoke-library'
import { useSettingsStore } from '../../stores/settings'
import { sameKaraokeTrack } from '../../types/karaoke'
import { tapScale, springSnappy, pageTransition } from '../../lib/motion-presets'
import { useMotion } from '../../hooks/useMotion'
import styles from './PlayerBar.module.css'
import panelStyles from './AccompanimentPanel.module.css'
import { AccompanimentPanel, KARAOKE_MEASURED, KARAOKE_PHASE } from './AccompanimentPanel'

/** 长按多久打开弹窗；进度环晚一点出现，普通点按不会闪出圆环。 */
const HOLD_MS = 450
const HOLD_RING_DELAY = 120
/** 浮层与播放栏上缘的间距 */
const POPOVER_GAP = 12

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
  const animated = useMotion('pageTransitionMotion')
  const trackKey = track ? `${track.source}:${String(track.id)}` : ''
  const original = track ? accompanimentOriginal(track) ?? track : null
  // 在原曲与“我的伴奏”条目之间切换会换当前曲目，但仍是同一首歌，弹窗保持打开。
  const songKey = original ? `${original.source}:${String(original.id)}` : ''
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const job = original ? jobs.find(job => job.phase !== 'failed' && sameKaraokeTrack(job.track, original)) : undefined
  const playable = track && track.source !== 'apple' ? accompanimentsForTrack(track, items).filter(item => item.available) : []
  const ready = playable.length
  // 点按在原唱与最近播放过的伴奏之间切换（没播放过则按所选模型、最新生成）；长按或右键打开完整弹窗。
  const preferred = track && ready ? findAccompaniment(track, items, model, played) : null
  const [holding, setHolding] = useState(false)
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean; busy: boolean }>({ fired: false, busy: false })
  // 生成期间记下已有成品数；任务结束后成品变多即视为完成（任务移除与成品入库的先后不定）。
  const baseline = useRef<number | null>(null)
  useEffect(() => { setOpen(false); setFresh(false); baseline.current = null }, [songKey])
  useEffect(() => {
    if (!open) return
    // 浮层挂在 body 上以保留玻璃模糊（播放栏自身也是玻璃，嵌在里面的模糊取不到页面内容），位置跟随麦克风按钮。
    const place = () => {
      const anchor = root.current?.getBoundingClientRect()
      // 竖直方向以整条播放栏的上缘为基准，按钮在栏内有内边距，直接贴按钮会压到播放栏。
      const bar = root.current?.closest('[data-player-bar]')?.getBoundingClientRect() ?? anchor
      const el = panel.current
      if (!anchor || !bar || !el) return
      el.style.right = `${Math.max(12, window.innerWidth - anchor.right)}px`
      el.style.bottom = `${window.innerHeight - bar.top + POPOVER_GAP}px`
      el.style.setProperty('--popover-max', `${Math.max(240, bar.top - POPOVER_GAP - 12)}px`)
    }
    place()
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('resize', place)
    window.addEventListener('pointerdown', outside)
    // 全局按键守卫在捕获阶段拦截后续传播，Esc 也需在捕获阶段监听。
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open])
  useEffect(() => {
    if (job) { baseline.current = Math.min(baseline.current ?? ready, ready); return }
    if (baseline.current !== null && ready > baseline.current) { baseline.current = null; if (!open) setFresh(true) }
  }, [job, ready, open])
  useEffect(() => { if (open) setFresh(false) }, [open])
  useEffect(() => () => clearTimeout(hold.current.timer), [])
  const usingStem = !!track && !!accompanimentId(accompaniment ?? track)
  const endHold = () => { clearTimeout(hold.current.timer); setHolding(false) }
  const startHold = (event: PointerEvent<HTMLButtonElement>) => {
    if (!preferred || event.button !== 0) return
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
    else setOpen(value => !value)
  }
  const active = !!accompaniment || !!(track && accompanimentOriginal(track))
  const measured = !!job && KARAOKE_MEASURED.includes(job.phase)
  const tip = !track ? '请先播放歌曲'
    : track.source === 'apple' ? 'Apple Music 暂不支持伴奏模式'
    : job && !preferred ? `${KARAOKE_PHASE[job.phase]}${measured ? ` ${Math.round(job.progress * 100)}%` : ''}`
    : preferred ? `${usingStem ? '切回原唱' : fresh ? '伴奏已生成，点按切换' : '切换到伴奏'} · 长按管理`
    : '选择或生成伴奏版本'

  return <div className={panelStyles.root} ref={root}>
    <motion.button
    type="button"
    className={`${styles.btn} ${styles.accompanimentBtn} no-drag`}
    data-active={active}
    data-busy={!!job}
    data-tip={tip}
    title={tip}
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
    {/* 与右侧工具图标同一 24 网格、17px、1.8 描边；使用伴奏时话筒头实心。 */}
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="15" cy="9" r="5.6" fill={active ? 'currentColor' : 'none'} />
      <path d="M11 13 4 19.1a1.2 1.2 0 0 0-.06 1.75l.21.21a1.2 1.2 0 0 0 1.75-.06L12 14" />
      {!active && <path d="m11.1 5.1 7.8 7.8" />}
    </svg>
    {job && <svg className={styles.accompanimentRing} data-indeterminate={!measured} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" pathLength="100" className={styles.accompanimentRingTrack} />
      <g className={styles.accompanimentRingArc}>
        <circle cx="16" cy="16" r="15" pathLength="100" transform="rotate(-90 16 16)" className={styles.accompanimentRingFill}
          strokeDasharray={measured ? `${Math.max(2, job.progress * 100)} 100` : '22 100'} />
      </g>
    </svg>}
    {holding && <svg className={styles.accompanimentHold} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" pathLength="100" transform="rotate(-90 16 16)" style={{ animationDuration: `${HOLD_MS - HOLD_RING_DELAY}ms`, animationDelay: `${HOLD_RING_DELAY}ms` }} />
    </svg>}
    {fresh && !job && <span className={styles.accompanimentDot} aria-hidden="true" />}
    </motion.button>
    {typeof document !== 'undefined' && createPortal(<AnimatePresence>{open && track && <motion.div key={songKey} ref={panel} className={`${panelStyles.popover} no-drag`}
      exit={{ opacity: 0 }} transition={animated ? pageTransition : { duration: 0 }}>
      <AccompanimentPanel track={track} onClose={() => setOpen(false)} />
    </motion.div>}</AnimatePresence>, document.body)}
  </div>
}
