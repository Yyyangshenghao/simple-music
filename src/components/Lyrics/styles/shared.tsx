import { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLyricsStore } from '../../../stores/lyrics'
import { usePlayerStore } from '../../../stores/player'
import { useSettingsStore } from '../../../stores/settings'
import { useMotion } from '../../../hooks/useMotion'
import { readLyricFrame, subscribeLyricFrames } from '../../../lib/lyric-frame-clock'
import { createOnsetDetector } from '../../../lib/lyric-beat'
import { fitLyricTransition, lyricLineDwellSec } from '../../../lib/lyric-tempo'
import { buildStyleWords, type StyleWord } from '../../../lib/lyric-style-layouts'
import { usePreciseLineIndex } from '../../../hooks/usePreciseLineIndex'
import styles from './shared.module.css'

export interface StyleLine {
  /** 当前句序号（精确换句时间下的） */
  index: number
  /** 句子身份：换歌或换句都会变，用作进出场与排版缓存的键 */
  key: string
  text: string
  lineStartMs: number
  dwellSec: number
  words: StyleWord[]
  translation: string
  /** 允许逐帧动画：未开减弱动态且未关闭逐字动效 */
  animated: boolean
  /** 切句过渡秒数（短句压缩） */
  switchSec: number
}

/** 当前句的逐词数据；没有歌词或间奏时 text 为空。 */
export function useStyleLine(preview: boolean): StyleLine {
  const trackKey = useLyricsStore(state => state.trackKey)
  const storeIndex = useLyricsStore(state => state.currentIndex)
  const lines = useLyricsStore(state => state.lines)
  const wordLines = useLyricsStore(state => state.wordLines)
  // 换句按帧时钟的精确时间（与跃字同一套）：store 的当前句会晚到最多约 0.27 秒。
  const index = usePreciseLineIndex(lines, wordLines, storeIndex)
  const translations = useLyricsStore(state => state.translation)
  const showTranslation = useSettingsStore(state => state.lyricsShowTranslation)
  const wordMotion = useSettingsStore(state => state.performance.lyricsWordMotion)
  const reducedMotion = !useMotion('lyricsLineMotion')
  const current = index >= 0 ? lines[index] : undefined
  const wordLine = index >= 0 ? wordLines[index] : undefined
  const dwellSec = lyricLineDwellSec(lines, index)
  const text = current?.text.trim() ?? ''
  const words = useMemo(() => text ? buildStyleWords(current!.text, wordLine, dwellSec) : [], [text, current, wordLine, dwellSec])
  return {
    key: `${trackKey}-${current?.time ?? 'none'}-${index}`,
    index,
    text,
    lineStartMs: (current?.time ?? 0) * 1000,
    dwellSec,
    words,
    translation: !preview && showTranslation && index >= 0 ? translations[index]?.text?.trim() ?? '' : '',
    animated: wordMotion,
    switchSec: reducedMotion ? 0 : fitLyricTransition(0.5, dwellSec),
  }
}

/**
 * 订阅共享帧时钟：播放且可见时逐帧回调，暂停/拖动/偏移变化各回调一次。
 * 回调拿到的是相对行起点的毫秒；回调本身经 ref 读取，不因重渲染重新订阅。
 */
export function useLyricFrames(lineStartMs: number, onFrame: (elapsedMs: number, now: number) => void, enabled = true): void {
  const handler = useRef(onFrame)
  handler.current = onFrame
  // 绘制前订阅：新句第一帧就按当前时间写好样式，不会先以默认全亮闪一下。
  useLayoutEffect(() => {
    if (!enabled) return
    return subscribeLyricFrames(frame => handler.current(frame.time * 1000 - lineStartMs, frame.now))
  }, [lineStartMs, enabled])
  // 每次重渲染（参数、排版或逐字时间变化）后立刻按当前时间重写；暂停时帧时钟不会再推送。
  useLayoutEffect(() => {
    if (!enabled) return
    const frame = readLyricFrame()
    handler.current(frame.time * 1000 - lineStartMs, frame.now)
  })
}

// 随拍检测全局共享：主舞台、退场中的旧句和选择器预览同一帧只读一次频谱，阈值也不随换句重置。
const sharedBeat = { detector: createOnsetDetector(), at: -1, pulse: 0, count: 0 }

function beatPulseAt(now: number): number {
  if (sharedBeat.at === now) return sharedBeat.pulse
  sharedBeat.at = now
  const player = usePlayerStore.getState()
  if (player.status !== 'playing') {
    sharedBeat.pulse = 0
    return 0
  }
  const signal = sharedBeat.detector.update(player._frequencyData(), now)
  if (signal.onset) sharedBeat.count++
  sharedBeat.pulse = signal.pulse
  return sharedBeat.pulse
}

/** 随拍脉冲与累计起拍数（用来左右交替倾斜等）；关闭或暂停时脉冲为 0。 */
export function useBeatState(enabled: boolean): (now: number) => { pulse: number; count: number } {
  return (now: number) => enabled ? { pulse: beatPulseAt(now), count: sharedBeat.count } : { pulse: 0, count: sharedBeat.count }
}

/**
 * 把内容缩到舞台里：先按原字号试排，放不下再有限次二分找最大可用倍数，写入 --style-fit。
 * 换行与字号不是线性关系，按比例一次缩放往往缩得过小。窗口、字体与内容变化时重新试排。
 */
export function useFitToStage(contentRef: RefObject<HTMLElement>, deps: readonly unknown[], options: { checkWidth?: boolean } = {}): void {
  const fontScale = useSettingsStore(state => state.lyricsFontScale)
  const checkWidth = options.checkWidth !== false
  useLayoutEffect(() => {
    const content = contentRef.current
    const stage = content?.closest<HTMLElement>('[data-style-stage]')
    if (!content || !stage) return
    let disposed = false
    const fit = () => {
      if (disposed) return
      const fits = (scale: number) => {
        content.style.setProperty('--style-fit', String(scale))
        return content.offsetHeight <= stage.clientHeight && (!checkWidth || content.scrollWidth <= stage.clientWidth)
      }
      if (fits(1)) return
      let low = 0.3
      let high = 1
      for (let pass = 0; pass < 7; pass++) {
        const middle = (low + high) / 2
        if (fits(middle)) low = middle
        else high = middle
      }
      content.style.setProperty('--style-fit', String(low))
    }
    // ResizeObserver 首次回调与这里同步的试排重复，跳过；字体仍在加载时才等它就绪后再排一次。
    let first = true
    const observer = new ResizeObserver(() => { if (first) first = false; else fit() })
    observer.observe(stage)
    if (document.fonts?.status === 'loading') void document.fonts.ready.then(fit)
    fit()
    return () => { disposed = true; observer.disconnect() }
  }, [...deps, fontScale, checkWidth])
}

/** 旧句淡出用时；新句在它退完后才入场，两句字面不会同时可读地叠在一起 */
const HANDOFF_SEC = 0.12
/** 两次换句间隔短于这个值（拖动、极快连句）或不是顺序进入下一句时，旧句直接撤下 */
const RAPID_SWITCH_MS = 300

const stageLineVariants = {
  exit: ({ rapid }: { rapid: boolean }) => (rapid
    ? { opacity: 0, transition: { duration: 0 } }
    : { opacity: 0, transition: { duration: HANDOFF_SEC, ease: 'easeOut' as const } }),
}

/**
 * 动态样式的共同外壳：舞台区域、整句进出场与底部译文。
 * 舞台尺寸按外层容器（歌词页或预览卡）的 cqw/cqh 计算，与跃字一致。
 */
export function StyleStage({ line, preview, className, children }: {
  line: StyleLine
  preview: boolean
  className?: string
  children: ReactNode
}) {
  const fontScale = useSettingsStore(state => state.lyricsFontScale)
  const switched = useRef({ key: line.key, index: line.index, at: 0, rapid: true })
  if (switched.current.key !== line.key) {
    const now = performance.now()
    const jumped = line.index !== switched.current.index + 1
    switched.current = { key: line.key, index: line.index, at: now, rapid: jumped || now - switched.current.at < RAPID_SWITCH_MS }
  }
  const rapid = switched.current.rapid || !line.switchSec
  return (
    <div className={`${styles.root}${className ? ` ${className}` : ''}`} style={{ '--lyrics-font-scale': preview ? 1 : fontScale } as React.CSSProperties}>
      <div className={styles.stage} data-style-stage>
        <AnimatePresence mode="popLayout" initial={false} custom={{ rapid }}>
          {line.text && (
            <motion.div
              key={line.key}
              className={styles.line}
              variants={stageLineVariants}
              custom={{ rapid }}
              // 交接：旧句先在 HANDOFF_SEC 内淡出，新句随后淡入；新句本就提前到上一句唱完后登场，首字不会被耽误。
              initial={line.switchSec ? { opacity: 0 } : false}
              animate={{ opacity: 1, transition: { delay: rapid ? 0 : HANDOFF_SEC, duration: Math.min(0.24, line.switchSec), ease: [0.22, 1, 0.36, 1] } }}
              exit="exit"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {line.translation && <div className={styles.translation}>{line.translation}</div>}
    </div>
  )
}
