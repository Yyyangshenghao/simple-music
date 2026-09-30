import { describe, expect, it, vi } from 'vitest'
import { createWordHighlightTimeline } from './word-highlight-timeline'

function element() {
  const animation = { currentTime: null as number | null, pause: vi.fn(), cancel: vi.fn() }
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => animation)
  return { node: { animate } as unknown as Element, animation, animate }
}

describe('原生逐字时间轴', () => {
  it('保留短音节原始时长，间奏不提前点亮下一字，拖回可以还原', () => {
    const first = element(), second = element()
    const timeline = createWordHighlightTimeline([first.node, second.node], [
      { text: '你', startMs: 100, durationMs: 30 },
      { text: '好', startMs: 900, durationMs: 300 }
    ])!
    expect(first.animate.mock.calls[0][1]).toMatchObject({ duration: 30 })
    timeline.seek(115)
    expect(first.animation.currentTime).toBe(15)
    timeline.seek(700)
    expect(first.animation.currentTime).toBe(30)
    expect(second.animation.currentTime).toBe(0)
    timeline.seek(1050)
    expect(second.animation.currentTime).toBe(150)
    timeline.seek(0)
    expect(first.animation.currentTime).toBe(0)
    expect(second.animation.currentTime).toBe(0)
    expect(first.animation.pause).toHaveBeenCalledOnce()
    timeline.dispose()
    expect(first.animation.cancel).toHaveBeenCalledOnce()
    expect(second.animation.cancel).toHaveBeenCalledOnce()
  })

  it('零时长字仅在原始时间戳处瞬时完成', () => {
    const item = element()
    const timeline = createWordHighlightTimeline([item.node], [{ text: '啊', startMs: 200, durationMs: 0 }])!
    timeline.seek(199)
    expect(item.animation.currentTime).toBe(0)
    timeline.seek(200)
    expect(item.animation.currentTime).toBe(1)
  })

  it('缺少真实时长时不创建模拟动画', () => {
    const item = element()
    expect(createWordHighlightTimeline([item.node], [{ text: '字', startMs: 0 }])).toBeNull()
    expect(item.animate).not.toHaveBeenCalled()
  })
})
