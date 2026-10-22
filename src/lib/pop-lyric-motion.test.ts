import { describe, expect, it, vi } from 'vitest'
import { createPopLyricTimeline, popLiftFactor, POP_GHOST_OPACITY } from './pop-lyric-motion'
import { POP_LEAD_MS } from './pop-lyric-timing'
import { buildPopWords } from './pop-lyric-timing'

const words = buildPopWords('甲乙', { time: 1, durationMs: 1600, words: [
  { text: '甲', startMs: 0, durationMs: 600 }, { text: '乙', startMs: 700, durationMs: 120 },
] }, 2)

function fixture(intensity?: number) {
  const make = () => {
    const animation = { currentTime: 0 as number | null, pause: vi.fn(), cancel: vi.fn() }
    const element = { animate: vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => animation) }
    return { animation, element }
  }
  const pops = [make(), make()]
  const inks = [make(), make()]
  const accents = [make(), make()]
  const els = (list: ReturnType<typeof make>[]) => list.map(item => item.element) as unknown as HTMLElement[]
  const timeline = createPopLyricTimeline(els(pops), els(inks), els(accents), words, { intensity })
  return { timeline, pops, inks, accents }
}

const liftOf = (frame: Keyframe) => Number(/translateY\((-?[\d.]+)em\)/.exec(String(frame.transform))![1])

describe('跃字逐字动画', () => {
  it('一种语法：静止 → 跃起 → 保持到唱完 → 回落；字影唱到时填满', () => {
    const { pops, inks, timeline } = fixture()
    const frames = pops[0].element.animate.mock.calls[0][0]
    expect(liftOf(frames[0])).toBe(0)
    expect(liftOf(frames[1])).toBeLessThan(0)
    expect(frames[2].transform).toBe(frames[1].transform)
    expect(liftOf(frames[3])).toBe(0)
    // 长音保持在跃起位直到演唱结束：保持段终点 = 提前量 + 演唱时长。
    const { duration } = pops[0].element.animate.mock.calls[0][1] as { duration: number }
    expect((frames[2].offset as number) * duration).toBeCloseTo(POP_LEAD_MS + 600)
    expect(inks[0].element.animate.mock.calls[0][0][0].opacity).toBe(POP_GHOST_OPACITY)
    timeline.dispose()
  })

  it('快字跃起幅度收敛，幅度参数按比例放大', () => {
    const plain = fixture()
    const slow = liftOf(plain.pops[0].element.animate.mock.calls[0][0][1])
    const fast = liftOf(plain.pops[1].element.animate.mock.calls[0][0][1])
    expect(Math.abs(fast)).toBeLessThan(Math.abs(slow))
    expect(popLiftFactor(120)).toBeLessThan(popLiftFactor(600))
    const strong = fixture(1.6)
    expect(Math.abs(liftOf(strong.pops[0].element.animate.mock.calls[0][0][1]))).toBeGreaterThan(Math.abs(slow))
    plain.timeline.dispose()
    strong.timeline.dispose()
  })

  it('由媒体时间定位：拖回恢复字影，跳到句尾全部回落，释放时清理', () => {
    const { pops, accents, timeline } = fixture()
    const all = [...pops, ...accents].map(item => item.animation)
    expect(all.every(animation => animation.pause.mock.calls.length === 1)).toBe(true)
    timeline.seek(300)
    expect(pops[0].animation.currentTime).toBe(300 + POP_LEAD_MS)
    expect(pops[1].animation.currentTime).toBe(0)
    timeline.seek(-100)
    expect(all.every(animation => animation.currentTime === 0)).toBe(true)
    timeline.seek(10_000)
    const { duration } = pops[1].element.animate.mock.calls[0][1] as { duration: number }
    expect(pops[1].animation.currentTime).toBe(duration)
    timeline.dispose()
    expect(all.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
  })

  it('同一句重新进入时动画完全一致，没有随机姿态', () => {
    const first = fixture()
    const second = fixture()
    expect(first.pops[0].element.animate.mock.calls).toEqual(second.pops[0].element.animate.mock.calls)
    expect(String(first.pops[0].element.animate.mock.calls[0][0][1].transform)).not.toMatch(/rotate/)
    first.timeline.dispose()
    second.timeline.dispose()
  })
})
