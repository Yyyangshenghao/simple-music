import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  now: 0,
  refs: [] as { current: unknown }[],
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[],
  memos: [] as { deps: readonly unknown[]; value: unknown }[],
  pending: [] as (() => void)[],
  refCursor: 0,
  effectCursor: 0,
  memoCursor: 0,
  frame: undefined as (() => void) | undefined,
  seek: vi.fn(),
  dispose: vi.fn(),
  createTimeline: vi.fn()
}))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (initial: unknown) => {
    const index = harness.refCursor++
    return harness.refs[index] ||= { current: initial }
  },
  useMemo: (create: () => unknown, deps: readonly unknown[]) => {
    const index = harness.memoCursor++
    const previous = harness.memos[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      harness.memos[index] = { deps, value: create() }
    }
    return harness.memos[index].value
  },
  useEffect: (create: () => void | (() => void), deps: readonly unknown[]) => {
    const index = harness.effectCursor++
    const previous = harness.effects[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      harness.pending.push(() => {
        previous?.cleanup?.()
        harness.effects[index] = { deps, cleanup: create() || undefined }
      })
    }
  }
}))
vi.mock('../../lib/word-highlight-timeline', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/word-highlight-timeline')>(),
  createWordHighlightTimeline: harness.createTimeline
}))
import { DesktopLyrics } from './DesktopLyrics'

const words = [{ text: '音乐', startMs: 0, durationMs: 1000 }]
const wordLine = { time: 1, durationMs: 1000, words }
function render(clock: { elapsedMs: number; playing: boolean; rate: number }, timed = true) {
  harness.refCursor = harness.effectCursor = harness.memoCursor = 0
  renderToStaticMarkup(<DesktopLyrics line="音乐" wordLine={timed ? { ...wordLine, words: [...words] } : undefined} wordClock={clock} />)
  for (const effect of harness.pending.splice(0)) effect()
}

beforeEach(() => {
  harness.now = 100
  harness.refs = [{ current: { querySelectorAll: () => [{}] } }]
  harness.effects = []
  harness.memos = []
  harness.pending = []
  harness.frame = undefined
  harness.seek.mockReset()
  harness.dispose.mockReset()
  harness.createTimeline.mockReset().mockReturnValue({ seek: harness.seek, dispose: harness.dispose })
  vi.stubGlobal('performance', { now: () => harness.now })
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { harness.frame = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => {
  for (const effect of harness.effects) effect.cleanup?.()
  vi.unstubAllGlobals()
})

it('跟随精确时钟和速度，外推不超过 150ms，暂停及跳播立即定位', () => {
  render({ elapsedMs: 100, playing: true, rate: 2 })
  harness.now = 150
  harness.frame?.()
  expect(harness.seek).toHaveBeenLastCalledWith(200)
  harness.now = 1000
  harness.frame?.()
  expect(harness.seek).toHaveBeenLastCalledWith(400)
  render({ elapsedMs: 300, playing: false, rate: 2 })
  harness.now = 2000
  harness.frame?.()
  expect(harness.seek).toHaveBeenLastCalledWith(300)
  render({ elapsedMs: 10, playing: false, rate: 1 })
  expect(harness.seek).toHaveBeenLastCalledWith(10)
  expect(harness.createTimeline).toHaveBeenCalledTimes(1)
})

it('关闭逐字时取消帧循环及字词动画', () => {
  render({ elapsedMs: 100, playing: true, rate: 1 })
  render({ elapsedMs: 150, playing: true, rate: 1 }, false)
  expect(harness.dispose).toHaveBeenCalledTimes(1)
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
})
