import { describe, expect, it, vi } from 'vitest'
import { createPopLyricTimeline } from './pop-lyric-motion'
import { buildPopWords } from './pop-lyric-timing'

const words = buildPopWords('甲乙', { time: 1, durationMs: 1600, words: [
  { text: '甲', startMs: 0, durationMs: 600 }, { text: '乙', startMs: 700, durationMs: 900 },
] }, 2)

function fixture() {
  const animations = Array.from({ length: 4 }, () => ({ currentTime: 0, pause: vi.fn(), cancel: vi.fn() }))
  const elements = animations.map(animation => ({ animate: vi.fn(() => animation) }))
  const timeline = createPopLyricTimeline(elements.slice(0, 2) as unknown as HTMLElement[], elements.slice(2) as unknown as HTMLElement[], words, 1000)
  return { timeline, animations, elements }
}

describe('跃字媒体时间轴', () => {
  it('构图镜头随媒体定位，暂停原生动画且释放时一起清理', () => {
    const camera = { currentTime: 0, pause: vi.fn(), cancel: vi.fn() }
    const glyph = () => ({ animate: () => ({ currentTime: 0, pause: vi.fn(), cancel: vi.fn() }) }) as unknown as HTMLElement
    const scene = { element: { animate: vi.fn(() => camera) } as unknown as HTMLElement, reveal: 'sweep' as const }
    const timeline = createPopLyricTimeline([glyph(), glyph()], [glyph(), glyph()], words, 1000, scene)
    expect(camera.pause).toHaveBeenCalledOnce()
    timeline.seek(800)
    expect(camera.currentTime).toBe(800)
    timeline.seek(-100)
    expect(camera.currentTime).toBe(0)
    timeline.seek(10_000)
    expect(camera.currentTime).toBe(1600)
    timeline.dispose()
    expect(camera.cancel).toHaveBeenCalledOnce()
  })
  it('暂停动画由媒体时钟定位，拖回时恢复等待态，跳到句尾完成回落', () => {
    const { timeline, animations } = fixture()
    expect(animations.every(animation => animation.pause.mock.calls.length === 1)).toBe(true)
    timeline.seek(800)
    expect(animations[0].currentTime).toBe(860)
    expect(animations[1].currentTime).toBe(160)
    expect(animations[3].currentTime).toBe(100)
    timeline.seek(-100)
    expect(animations.every(animation => animation.currentTime === 0)).toBe(true)
    timeline.seek(10_000)
    expect(animations[0].currentTime).toBeLessThan(2000)
    expect(animations[3].currentTime).toBe(1260)
    timeline.dispose()
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
  })

  it('同一句重新进入时姿态一致，词之间有不同姿态', () => {
    const first = fixture()
    const second = fixture()
    expect(first.elements[0].animate.mock.calls).toEqual(second.elements[0].animate.mock.calls)
    expect(first.elements[0].animate.mock.calls).not.toEqual(first.elements[1].animate.mock.calls)
    first.timeline.dispose()
    second.timeline.dispose()
  })

  it('动效幅度与镜头推移可调，默认值与原设计一致', () => {
    const run = (tuning: { intensity?: number; camera?: boolean }) => {
      const camera = { currentTime: 0, pause: vi.fn(), cancel: vi.fn() }
      const element = { animate: vi.fn(() => camera) }
      const glyphs = Array.from({ length: 4 }, () => ({ animate: vi.fn((_frames: Keyframe[]) => ({ currentTime: 0, pause: vi.fn(), cancel: vi.fn() })) }))
      const timeline = createPopLyricTimeline(glyphs.slice(0, 2) as unknown as HTMLElement[], glyphs.slice(2) as unknown as HTMLElement[], words, 1000,
        { element: element as unknown as HTMLElement, reveal: 'rise', ...tuning })
      timeline.dispose()
      return { cameraCalls: element.animate.mock.calls.length, frames: glyphs[0].animate.mock.calls[0][0] as Keyframe[] }
    }
    const plain = run({})
    expect(run({ intensity: 1, camera: true })).toEqual(plain)
    expect(plain.cameraCalls).toBe(1)
    expect(run({ camera: false }).cameraCalls).toBe(0)
    // 幅度越大入场缩放越小（离 1 越远），回落终态始终是原尺寸。
    const scaleOf = (frame: Keyframe) => Number(/scale\(([\d.]+)\)/.exec(String(frame.transform))![1])
    expect(scaleOf(run({ intensity: 1.6 }).frames[0])).toBeLessThan(scaleOf(plain.frames[0]))
    expect(scaleOf(run({ intensity: 0.4 }).frames[0])).toBeGreaterThan(scaleOf(plain.frames[0]))
    expect(scaleOf(run({ intensity: 1.6 }).frames[3])).toBe(1)
  })
})
