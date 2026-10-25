import { describe, expect, it, vi } from 'vitest'
import { createPopLyricTimeline, popLiftFactor, popPeakScale, POP_PEAK_SCALE, type PopMotionTuning } from './pop-lyric-motion'
import { POP_LEAD_MS } from './pop-lyric-timing'
import { buildPopWords } from './pop-lyric-timing'

const words = buildPopWords('甲乙', { time: 1, durationMs: 1600, words: [
  { text: '甲', startMs: 0, durationMs: 600 }, { text: '乙', startMs: 700, durationMs: 120 },
] }, 2)

function fixture(intensity?: number, peaks?: number[], options: PopMotionTuning = {}) {
  const make = () => {
    const animation = { currentTime: 0 as number | null, pause: vi.fn(), cancel: vi.fn() }
    const element = { animate: vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => animation) }
    return { animation, element }
  }
  const pops = [make(), make()]
  const inks = [make(), make()]
  const accents = [make(), make()]
  const els = (list: ReturnType<typeof make>[]) => list.map(item => item.element) as unknown as HTMLElement[]
  const scene = make()
  const timeline = createPopLyricTimeline(els(pops), els(inks), els(accents), words, { intensity, peaks, ...options, scene: options.scene ? scene.element as unknown as HTMLElement : undefined })
  return { timeline, pops, inks, accents, scene }
}

const liftOf = (frame: Keyframe) => Number(/translateY\((-?[\d.]+)em\)/.exec(String(frame.transform))![1])
const scaleOf = (frame: Keyframe) => Number(/scale\(([\d.]+)\)/.exec(String(frame.transform))![1])

describe('跃字逐字动画', () => {
  it.each(['fold', 'sweep', 'rise'] as const)('%s 构图有各自入场方向，唱完回到相同落位', reveal => {
    const { pops, timeline } = fixture(1, undefined, { reveal })
    const frames = pops[0].element.animate.mock.calls[0][0]
    expect(frames[0].transform).not.toBe(frames[3].transform)
    expect(frames[0].transform).toContain('rotate')
    expect(frames[3].transform).toBe('translateY(0em) scale(1)')
    timeline.dispose()
  })

  it('镜头与逐字共用媒体时间：暂停重读保持，倒拖回位，销毁时取消', () => {
    const { timeline, scene } = fixture(1, undefined, { scene: {} as HTMLElement, reveal: 'sweep' })
    expect(scene.animation.pause).toHaveBeenCalledOnce()
    timeline.seek(600)
    expect(scene.animation.currentTime).toBe(600)
    timeline.seek(600)
    expect(scene.animation.currentTime).toBe(600)
    timeline.seek(-100)
    expect(scene.animation.currentTime).toBe(0)
    timeline.seek(10000)
    expect(scene.animation.currentTime).toBe(1200)
    timeline.dispose()
    expect(scene.animation.cancel).toHaveBeenCalledOnce()
  })

  it('一种语法：静止 → 放大跃起 → 保持到唱完 → 回落原位；字墨唱到时填满', () => {
    const { pops, inks, timeline } = fixture()
    const frames = pops[0].element.animate.mock.calls[0][0]
    expect(liftOf(frames[0])).toBe(0)
    expect(liftOf(frames[1])).toBeLessThan(0)
    expect(frames[2].transform).toBe(frames[1].transform)
    expect(liftOf(frames[3])).toBe(0)
    // 慢字达到目标峰值放大量，唱完回到原大小
    expect(scaleOf(frames[1])).toBeCloseTo(POP_PEAK_SCALE)
    expect(scaleOf(frames[3])).toBe(1)
    // 长音保持在跃起位直到演唱结束：保持段终点 = 提前量 + 演唱时长。
    const { duration } = pops[0].element.animate.mock.calls[0][1] as { duration: number }
    expect((frames[2].offset as number) * duration).toBeCloseTo(POP_LEAD_MS + 600)
    // 字墨盖在字影层上：未唱时透明，只见字影
    expect(inks[0].element.animate.mock.calls[0][0][0].opacity).toBe(0)
    timeline.dispose()
  })

  it('快字跃起与放大都收敛，幅度参数按比例放大', () => {
    const plain = fixture()
    const slow = liftOf(plain.pops[0].element.animate.mock.calls[0][0][1])
    const fast = liftOf(plain.pops[1].element.animate.mock.calls[0][0][1])
    expect(Math.abs(fast)).toBeLessThan(Math.abs(slow))
    expect(scaleOf(plain.pops[1].element.animate.mock.calls[0][0][1])).toBeLessThan(scaleOf(plain.pops[0].element.animate.mock.calls[0][0][1]))
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

  it('按实测峰值放大，不超过空隙允许的量', () => {
    const { pops, timeline } = fixture(1, [1.05, 1.15])
    expect(scaleOf(pops[0].element.animate.mock.calls[0][0][1])).toBeCloseTo(1.05)
    timeline.dispose()
  })
})

describe('演唱字峰值放大量', () => {
  it('汉字按目标值放大；英文长词受词间空隙限制，与邻字不压叠', () => {
    // 汉字：字面 0.94em，每侧可用约 0.08em → 不受限，取目标值
    expect(popPeakScale(0.94, 0.08)).toBeCloseTo(POP_PEAK_SCALE)
    // 英文长词：字面 6em，每侧 0.19em → 每侧放大量不超过 0.19em
    const long = popPeakScale(6, 0.19)
    expect(long).toBeLessThan(POP_PEAK_SCALE)
    expect((long - 1) * 6 / 2).toBeLessThanOrEqual(0.19 + 1e-9)
    // 行首行尾一侧不受限；幅度参数只在空隙内起作用
    expect(popPeakScale(2, Infinity)).toBeCloseTo(POP_PEAK_SCALE)
    expect(popPeakScale(0.94, 0.08, 1.6)).toBeLessThanOrEqual(1 + 0.16 / 0.94 + 1e-9)
    expect(popPeakScale(0.94, 0.08, 0.4)).toBeCloseTo(1 + (POP_PEAK_SCALE - 1) * 0.4)
  })
})
