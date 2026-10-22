import { POP_LEAD_MS, type PopWord } from './pop-lyric-timing'

/**
 * 跃字的逐字动画：一种语法——跃起、演唱保持、回落。
 * 未唱的字只留淡字影（由 CSS 的字影层显示，播放时更轻）；轮到时字墨填满，字放大并跃起、换上强调色，
 * 成为画面的形态重心；唱完回落到原位成实字，强调色随即褪去，重心交给下一个字。
 * 幅度随该字演唱时长收敛：快字只轻点一下，长音一直保持在跃起位，唱完才回落。
 * 全部由媒体时间定位（暂停、拖动、倒拖都准确），同一句每次进入的动画完全一致。
 */

/** 暂停时未唱字影的不透明度（与 CSS 的 --pop-ghost 默认值一致） */
export const POP_GHOST_OPACITY = 0.3
/** 演唱字的目标峰值放大量；实际值受相邻字的空隙限制，见 popPeakScale */
export const POP_PEAK_SCALE = 1.15
/** 回落用时：要短，重心尽快交给下一个字 */
const SETTLE_MS = 180
/** 唱完后强调色褪去的用时：要短，暂停画面里只有正在唱的字是强调色 */
const ACCENT_FADE_MS = 160
/** 跃起高度（em），乘以 intensity 与时长系数 */
const LIFT_EM = 0.12

/**
 * 用户可调的跃字参数：intensity 按比例放大或收敛跃起高度与放大量（1 为默认）。
 * peaks 是每个字按实测宽度算好的峰值放大量（见 popPeakScale），缺省时用目标值。
 */
export interface PopMotionTuning {
  intensity?: number
  peaks?: readonly number[]
}

/** 演唱时长对应的幅度系数：快字收敛，320ms 以上为满幅。 */
export function popLiftFactor(durationMs: number): number {
  return Math.min(1, Math.max(0.4, durationMs / 320))
}

/**
 * 一个字（或英文词）最多放大到多少而不碰到邻字：字面宽 inkEm、每侧可用空隙 roomEm（都以 em 计）。
 * 每侧只用一半空隙，两个相邻字同时处在峰值也不会压叠。intensity 只在空隙允许的范围内起作用。
 */
export function popPeakScale(inkEm: number, roomEm: number, intensity = 1): number {
  const k = Math.min(1.6, Math.max(0.4, intensity))
  const wanted = (POP_PEAK_SCALE - 1) * k
  const allowed = inkEm > 0 ? (2 * Math.max(0, roomEm)) / inkEm : wanted
  return 1 + Math.max(0, Math.min(wanted, allowed))
}

export function createPopLyricTimeline(pops: HTMLElement[], inks: HTMLElement[], accents: HTMLElement[], words: PopWord[], tuning: PopMotionTuning = {}) {
  const k = Math.min(1.6, Math.max(0.4, tuning.intensity ?? 1))
  const entries = words.map((word, index) => {
    const sing = Math.max(1, word.durationMs)
    // 跃起用时：不超过 110ms，也不超过这个字可用时间的一半，峰值落在开唱时刻附近。
    const rise = Math.round(Math.min(110, Math.max(40, (POP_LEAD_MS + sing) * 0.5)))
    const held = POP_LEAD_MS + sing
    const duration = held + SETTLE_MS
    const factor = popLiftFactor(sing)
    const peak = tuning.peaks?.[index] ?? popPeakScale(1, Infinity, k)
    const up = `translateY(${(-LIFT_EM * factor * k).toFixed(3)}em) scale(${(1 + (peak - 1) * factor).toFixed(3)})`
    const rest = 'translateY(0em) scale(1)'
    const pop = pops[index].animate([
      { transform: rest },
      { transform: up, offset: rise / duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      { transform: up, offset: held / duration, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
      { transform: rest },
    ], { duration, fill: 'both', easing: 'linear' })
    // 字墨层盖在字影层上：未唱时透明（只见字影），唱到时填满。
    const ink = inks[index].animate([
      { opacity: 0 },
      { opacity: 1, offset: rise / duration },
      { opacity: 1 },
    ], { duration, fill: 'both', easing: 'linear' })
    const accentDuration = held + ACCENT_FADE_MS
    const accent = accents[index].animate([
      { opacity: 0 },
      { opacity: 1, offset: rise / accentDuration },
      { opacity: 1, offset: held / accentDuration, easing: 'ease-out' },
      { opacity: 0 },
    ], { duration: accentDuration, fill: 'both', easing: 'linear' })
    pop.pause()
    ink.pause()
    accent.pause()
    return { word, animations: [pop, ink, accent], durations: [duration, duration, accentDuration] }
  })
  return {
    seek(elapsed: number) {
      if (!Number.isFinite(elapsed)) return
      for (const entry of entries) {
        const local = elapsed - entry.word.startMs + POP_LEAD_MS
        entry.animations.forEach((animation, i) => {
          const at = Math.min(entry.durations[i], Math.max(0, local))
          if (animation.currentTime !== at) animation.currentTime = at
        })
      }
    },
    dispose() {
      entries.forEach(({ animations }) => animations.forEach(animation => animation.cancel()))
    },
  }
}
