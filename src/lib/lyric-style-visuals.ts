import type { WordState } from './lyric-style-layouts'

/**
 * 流光、倾诉、云阶的逐帧视觉：输入词的时间状态与参数，输出要写到元素上的值。
 * 纯函数，组件每帧调用后直接写 style，不触发 React 重渲染。
 * animated 为 false（减弱动态或关闭逐字动效）时全文可读，只用颜色标出正在唱的词。
 */

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)

export interface LuminousVisual {
  opacity: number
  /** 竖直位移（em，正值向下），叠加在散布姿态上 */
  lift: number
  scale: number
  blur: number
  /** 强调色比例 0..1 */
  heat: number
  /** 辉光强度，0 表示不画 */
  glow: number
  /** 涟漪进度 0..1，1 表示不显示 */
  ripple: number
}

export function luminousVisual(state: WordState, options: { animated: boolean; glow: number; ripple: boolean; beat: number }): LuminousVisual {
  if (!options.animated) {
    return { opacity: state.phase === 'waiting' ? 0.55 : 1, lift: 0, scale: 1, blur: 0, heat: state.phase === 'active' ? 1 : 0, glow: 0, ripple: 1 }
  }
  const ripple = options.ripple && state.sinceStart >= 0 ? Math.min(1, state.sinceStart / 900) : 1
  if (state.phase === 'waiting') {
    // 开唱前 0.5s 开始浮起，其余时间保持浅淡的预备姿态。
    const lead = clamp01((state.sinceStart + 500) / 500)
    return { opacity: 0.16 + 0.24 * lead, lift: (1 - lead) * 0.3, scale: 0.94 + 0.06 * lead, blur: (1 - lead) * 3, heat: 0, glow: 0, ripple }
  }
  if (state.phase === 'active') {
    const glow = options.glow * (0.6 + 0.4 * Math.sin(Math.PI * state.progress)) * (1 + options.beat * 0.8)
    return { opacity: 1, lift: 0, scale: 1 + 0.08 * easeOut(state.sinceStart / 220), blur: 0, heat: 1, glow, ripple }
  }
  // 唱后余晖：光与强调色指数衰减，词慢慢上漂到一个上限。
  const decay = Math.exp(-state.sinceEnd / 900)
  return { opacity: 0.62 + 0.38 * decay, lift: -Math.min(0.22, state.sinceEnd / 6000), scale: 1, blur: 0, heat: decay * 0.6, glow: options.glow * decay * 0.6, ripple }
}

export interface TiltVisual {
  opacity: number
  /** 浮现时的下沉量（em） */
  rise: number
  blur: number
  heat: number
}

export function tiltVisual(state: WordState, animated: boolean): TiltVisual {
  const heat = state.phase === 'active' ? 1 : state.phase === 'passed' && animated ? Math.exp(-state.sinceEnd / 500) : 0
  if (!animated) return { opacity: state.phase === 'waiting' ? 0.5 : 1, rise: 0, blur: 0, heat }
  // 提前 0.12s 起浮，0.26s 内落定：词像被轻轻写上去。
  const t = clamp01((state.sinceStart + 120) / 260)
  return { opacity: t, rise: (1 - t) * 0.35, blur: (1 - t) * 4, heat }
}

export interface PartitaVisual {
  opacity: number
  scale: number
  heat: number
}

// 轻微过冲：放大时先超一点再落稳，读起来更有落拍感。
const easeOutBack = (t: number) => {
  const x = clamp01(t) - 1
  return 1 + 2.2 * x * x * x + 1.2 * x * x
}

export function partitaVisual(state: WordState, options: { animated: boolean; emphasis: number }): PartitaVisual {
  const peak = 0.32 * options.emphasis
  if (state.phase === 'waiting') return { opacity: options.animated ? 0.22 : 0.5, scale: 1, heat: 0 }
  if (state.phase === 'active') {
    return { opacity: 1, scale: options.animated ? 1 + peak * easeOutBack(state.sinceStart / 260) : 1, heat: 1 }
  }
  // 唱后 0.35s 内回落到原字号，强调色随之退去。
  const settle = options.animated ? clamp01(state.sinceEnd / 350) : 1
  return { opacity: 0.92, scale: 1 + peak * (1 - settle), heat: 1 - settle }
}
