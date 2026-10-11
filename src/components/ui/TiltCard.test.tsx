import type { PointerEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TiltCard } from './TiltCard'

const h = vi.hoisted(() => ({
  reduced: false,
  performance: { cardTiltEffect: true, cardSpotlightEffect: true },
  ref: { current: null as unknown },
  effects: [] as Array<() => void>,
  values: [ { set: vi.fn() }, { set: vi.fn() } ],
  cursor: 0,
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: () => h.ref,
  useEffect: (effect: () => void) => { h.effects.push(effect) },
}))
vi.mock('motion/react', () => ({
  motion: { div: 'div' },
  useMotionValue: () => h.values[h.cursor++],
  useSpring: (value: unknown) => value,
  useTransform: () => 'pointer-rotation',
}))
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => h.reduced }))
vi.mock('../../stores/settings', () => ({ useSettingsStore: (select: (state: typeof h) => unknown) => select(h) }))

const style = { setProperty: vi.fn(), removeProperty: vi.fn() }
const element = { style, getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }) }
function render(disabled = false) {
  h.cursor = 0
  const tree = TiltCard({ children: '歌单', disabled })
  h.ref.current = element
  h.effects.splice(0).forEach(effect => effect())
  return tree
}
beforeEach(() => {
  h.reduced = false
  h.performance.cardTiltEffect = h.performance.cardSpotlightEffect = true
  h.effects = []
  vi.clearAllMocks()
})

describe('卡片交互解耦', () => {
  it.each([[true, true], [true, false], [false, true], [false, false]])('倾斜 %s、光斑 %s 各自响应指针', (tilt, spotlight) => {
    h.performance.cardTiltEffect = tilt
    h.performance.cardSpotlightEffect = spotlight
    const tree = render()
    vi.clearAllMocks()
    tree.props.onPointerMove?.({ clientX: 160, clientY: 45 } as PointerEvent<HTMLDivElement>)
    expect(tree.props.style.rotateX).toBe(tilt ? 'pointer-rotation' : 0)
    if (tilt) {
      expect(h.values[0].set).toHaveBeenCalledWith(0.75)
      expect(h.values[1].set).toHaveBeenCalledWith(0.25)
    } else {
      expect(h.values[0].set).not.toHaveBeenCalled()
      expect(h.values[1].set).not.toHaveBeenCalled()
    }
    if (spotlight) {
      expect(style.setProperty).toHaveBeenCalledWith('--spot-x', '150px')
      expect(style.setProperty).toHaveBeenCalledWith('--spot-y', '25px')
    } else {
      expect(style.setProperty).not.toHaveBeenCalled()
    }
    expect(Boolean(tree.props.onPointerMove)).toBe(tilt || spotlight)
    expect(tree.props.whileTap).toEqual({ scale: 0.97 })
  })

  it('运行时关闭各效果分别清理残留，系统减少动态暂停全部指针与位移反馈', () => {
    render()
    vi.clearAllMocks()
    h.performance.cardTiltEffect = false
    render()
    expect(h.values[0].set).toHaveBeenCalledWith(0.5)
    expect(style.removeProperty).not.toHaveBeenCalled()
    h.performance.cardSpotlightEffect = false
    render()
    expect(style.removeProperty).toHaveBeenCalledWith('--spot-x')
    expect(style.removeProperty).toHaveBeenCalledWith('--spot-y')
    h.performance.cardTiltEffect = h.performance.cardSpotlightEffect = true
    h.reduced = true
    const tree = render()
    expect(tree.props.onPointerMove).toBeUndefined()
    expect(tree.props.whileTap).toBeUndefined()
    expect(tree.props.whileHover).toBeUndefined()
    expect(h.performance).toEqual({ cardTiltEffect: true, cardSpotlightEffect: true })
  })
})
