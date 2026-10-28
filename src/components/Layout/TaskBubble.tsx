import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useSpring, useTransform } from 'motion/react'
import { useTaskCenterStore } from '../../stores/task-center'
import { useMotion } from '../../hooks/useMotion'
import { useSystemReducedMotion } from '../../hooks/useSystemReducedMotion'
import { taskEntrySpring, springSnappy, tapScale, taskPopoverMotion } from '../../lib/motion-presets'
import { TaskPanel } from './TaskPanel'
import { HoverTips } from '../ui/HoverTips'
import styles from './TaskBubble.module.css'

/** 位移与按压分别拥有一层，手势结束不能改写入口的位置或尺寸。 */
export function TaskBubble({ children }: { children: ReactNode }) {
  const { open, visible, summary, pulse, completion, batchResults } = useTaskCenterStore()
  const [panelHeld, setPanelHeld] = useState(open)
  const split = useMotion('queueSplitMotion')
  const sprout = useMotion('popoverSproutMotion')
  const reduceMotion = useSystemReducedMotion()
  const animated = split && !reduceMotion
  const tap = useMotion('tapFeedbackMotion')
  const progress = useSpring(visible || panelHeld ? 1 : 0, taskEntrySpring)
  const width = useTransform(progress, value => Math.max(0, value * 44))
  const x = useTransform(progress, [0, 1], [12, 0])
  const opacity = useTransform(progress, [0, .4, 1], [0, 0, 1])
  const anchor = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const face = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const pulseAnimation = useRef<Animation | null>(null)
  const lastPulse = useRef(pulse)
  const lastCompletion = useRef(completion)
  useLayoutEffect(() => { if (open) setPanelHeld(true) }, [open])
  useEffect(() => { progress.set(visible || open || panelHeld ? 1 : 0) }, [visible, open, panelHeld, progress])
  useEffect(() => {
    if (pulse === lastPulse.current) return
    lastPulse.current = pulse
    // 首次浮现已确认加入；连续入队合并为一次轻反馈。
    if (!animated || progress.get() < .96 || !face.current || pulseAnimation.current?.playState === 'running') return
    pulseAnimation.current = face.current.animate([{ scale: '1' }, { scale: '.94' }, { scale: '1' }], { duration: 240, easing: 'ease-out' })
  }, [pulse, animated, progress])
  useEffect(() => () => pulseAnimation.current?.cancel(), [])
  useEffect(() => {
    if (completion === lastCompletion.current) return
    lastCompletion.current = completion
    if (!animated || !face.current) return
    pulseAnimation.current?.cancel()
    const animation = face.current.animate([{ scale: '1' }, { scale: '1.08' }, { scale: '1' }], { duration: 360, easing: 'ease-out' })
    return () => animation.cancel()
  }, [completion, animated])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect || !panel.current) return
      const panelWidth = Math.min(440, window.innerWidth - 32)
      const left = Math.max(16, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 16))
      panel.current.style.top = `${rect.bottom + 12}px`
      panel.current.style.left = `${left}px`
      panel.current.style.transformOrigin = `${rect.left + rect.width / 2 - left}px 0`
    }
    place()
    const off = progress.on('change', place)
    const outside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) useTaskCenterStore.getState().close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !panel.current?.querySelector('[data-task-menu]')) useTaskCenterStore.getState().close()
    }
    window.addEventListener('resize', place)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    return () => { off(); window.removeEventListener('resize', place); window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true) }
  }, [open, progress])
  const count = summary.download + summary.karaoke
  const complete = !count && !summary.failed && !summary.issue && batchResults.length > 0
  const title = [summary.download && `${summary.download} 首下载任务`, summary.karaoke && `${summary.karaoke} 首伴奏任务`, summary.failed && `${summary.failed} 首失败`, summary.allPaused && '已暂停'].filter(Boolean).join(' · ') || (summary.issue ? '任务队列需要处理，查看详情' : complete ? '任务已完成，查看结果' : '任务队列')
  const ringProgress = summary.progress
  const circumference = 2 * Math.PI * 18.5
  const collapsed = { opacity: 0, clipPath: 'inset(0% 0% 100% 92% round 22px)' }
  return <div className={`${styles.root} no-drag`}>
    <motion.div className={styles.slot} style={{ width }}>
      <motion.div ref={anchor} className={styles.buttonPosition} style={{ x: animated ? x : 0, opacity }}>
      <motion.button ref={button} type="button" className={styles.toggle} aria-label="任务队列" data-tip={title} aria-expanded={open} aria-controls="task-center-panel"
        aria-hidden={!visible && !panelHeld} tabIndex={visible ? 0 : -1} data-active={open} data-state={complete ? 'complete' : summary.running ? 'running' : count ? 'waiting' : 'idle'} style={{ pointerEvents: visible || panelHeld ? 'auto' : 'none' }}
        animate={{ scale: 1 }} whileTap={tap && !reduceMotion ? tapScale : undefined} transition={springSnappy} onClick={() => open ? useTaskCenterStore.getState().close() : useTaskCenterStore.getState().show()}>
        <span ref={face} className={styles.face}>
          {summary.running > 0 && <svg className={styles.ring} data-progress-ring data-spinning={ringProgress === null} width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <motion.circle key={summary.currentKey} cx="20" cy="20" r="18.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              strokeDasharray={ringProgress === null ? `${circumference * .22} ${circumference * .78}` : `${circumference} ${circumference}`} initial={false}
              animate={{ strokeDashoffset: ringProgress === null ? 0 : circumference * (1 - ringProgress) }} transition={{ duration: reduceMotion ? 0 : .18, ease: 'linear' }} />
          </svg>}
          <AnimatePresence initial={false}><motion.span className={styles.glyph} key={complete ? 'complete' : summary.current} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .12 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {complete ? <motion.path d="m5 12 4.5 4.5L19 7" initial={animated ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: animated ? .24 : 0, ease: 'easeOut' }} />
                : summary.current === 'download' ? <path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /> : <><rect x="8" y="2" width="8" height="13" rx="4" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>}
            </svg>
          </motion.span></AnimatePresence>
        </span>
        {!!count && <span className={styles.badge}>{summary.allPaused ? <svg width="9" height="10" viewBox="0 0 9 10" stroke="currentColor" strokeWidth="2" aria-label="已暂停"><path d="M2 1v8M7 1v8" /></svg>
          : <AnimatePresence initial={false} mode="popLayout"><motion.span key={count} initial={animated ? { y: 7, opacity: 0 } : false} animate={{ y: 0, opacity: 1 }} exit={{ y: animated ? -7 : 0, opacity: 0 }} transition={{ duration: .14 }}>{count > 99 ? '99+' : count}</motion.span></AnimatePresence>}</span>}
        {(summary.failed > 0 || summary.issue) && <span className={styles.failureDot} />}
      </motion.button>
      </motion.div>
    </motion.div>
    <HoverTips match='button[aria-label="任务队列"]' />
    {children}
    {typeof document !== 'undefined' && createPortal(<AnimatePresence onExitComplete={() => { if (!useTaskCenterStore.getState().open) setPanelHeld(false) }}>
      {open && <motion.div key="task-panel" ref={panel} className={`${styles.panelAnchor} no-drag`}
        initial={sprout && !reduceMotion ? collapsed : { opacity: 0 }} animate={{ opacity: 1, clipPath: 'inset(0% 0% 0% 0% round 22px)' }}
        exit={{ ...(sprout && !reduceMotion ? collapsed : { opacity: 0 }), transition: sprout ? taskPopoverMotion.exit : { duration: .1 } }}
        transition={sprout && !reduceMotion ? taskPopoverMotion.enter : { duration: .1 }}
        onAnimationComplete={() => { if (useTaskCenterStore.getState().open && panel.current) panel.current.style.clipPath = 'none' }}><TaskPanel /></motion.div>}
    </AnimatePresence>, document.body)}
  </div>
}
