import { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLyricsStore } from '../../../stores/lyrics'
import { usePlayerStore } from '../../../stores/player'
import { useSettingsStore } from '../../../stores/settings'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import { readLyricFrame, subscribeLyricFrames } from '../../../lib/lyric-frame-clock'
import { createOnsetDetector } from '../../../lib/lyric-beat'
import { fitLyricTransition, lyricLineDwellSec } from '../../../lib/lyric-tempo'
import { buildStyleWords, type StyleWord } from '../../../lib/lyric-style-layouts'
import styles from './shared.module.css'

export interface StyleLine {
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
  const index = useLyricsStore(state => state.currentIndex)
  const lines = useLyricsStore(state => state.lines)
  const wordLines = useLyricsStore(state => state.wordLines)
  const translations = useLyricsStore(state => state.translation)
  const showTranslation = useSettingsStore(state => state.lyricsShowTranslation)
  const wordMotion = useSettingsStore(state => state.performance.lyricsWordMotion)
  const reducedMotion = useReducedMotion()
  const current = index >= 0 ? lines[index] : undefined
  const wordLine = index >= 0 ? wordLines[index] : undefined
  const dwellSec = lyricLineDwellSec(lines, index)
  const text = current?.text.trim() ?? ''
  const words = useMemo(() => text ? buildStyleWords(current!.text, wordLine, dwellSec) : [], [text, current, wordLine, dwellSec])
  return {
    key: `${trackKey}-${current?.time ?? 'none'}-${index}`,
    text,
    lineStartMs: (current?.time ?? 0) * 1000,
    dwellSec,
    words,
    translation: !preview && showTranslation && index >= 0 ? translations[index]?.text?.trim() ?? '' : '',
    animated: wordMotion && !reducedMotion,
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

/** 随拍脉冲：返回 0..1 的衰减值；关闭或暂停时为 0。 */
export function useBeatPulse(enabled: boolean): (now: number) => number {
  return (now: number) => enabled ? beatPulseAt(now) : 0
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
  return (
    <div className={`${styles.root}${className ? ` ${className}` : ''}`} style={{ '--lyrics-font-scale': preview ? 1 : fontScale } as React.CSSProperties}>
      <div className={styles.stage} data-style-stage>
        <AnimatePresence mode="popLayout" initial={false}>
          {line.text && (
            <motion.div
              key={line.key}
              className={styles.line}
              initial={line.switchSec ? { opacity: 0, filter: 'blur(6px)' } : false}
              // 入场结束清掉 filter：常驻 blur(0px) 会让整句一直走离屏合成。
              animate={{ opacity: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
              // 旧句先快速淡到看不清，再慢慢走完虚化，新句首字不必等它退场。
              exit={line.switchSec ? {
                opacity: 0, filter: 'blur(8px)',
                transition: { opacity: { duration: Math.min(0.16, line.switchSec), ease: 'easeOut' }, filter: { duration: line.switchSec } },
              } : { opacity: 0, transition: { duration: 0 } }}
              transition={{ duration: line.switchSec, ease: [0.22, 1, 0.36, 1] }}
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
