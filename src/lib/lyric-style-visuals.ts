import type { WordState } from './lyric-style-layouts'

/**
 * 云阶的逐帧视觉：输入词的时间状态与参数，输出要写到元素上的值。
 * 纯函数，组件每帧调用后直接写 style，不触发 React 重渲染。
 * animated 为 false（减弱动态或关闭逐字动效）时全文可读，只用颜色标出正在唱的词。
 */

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

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
