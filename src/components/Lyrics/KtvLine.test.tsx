import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KtvLine } from './KtvLine'

const h = vi.hoisted(() => ({
  reduced: false, enabled: true,
  deps: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
  element: { querySelectorAll: vi.fn() },
}))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: () => ({ current: h.element }),
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    if (h.deps && deps.every((value, index) => Object.is(value, h.deps![index]))) return
    h.cleanup?.()
    h.deps = deps
    h.cleanup = effect()
  },
}))
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => h.reduced }))
vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({ performance: { lyricsWordMotion: h.enabled } }),
}))
vi.mock('../../stores/player', () => ({ usePlayerStore: { getState: () => ({ position: 0.5 }) } }))
vi.mock('../../stores/lyrics', () => ({ useLyricsStore: { getState: () => ({ offsetSec: 0 }) } }))
vi.mock('../../lib/lyric-playback-position', () => ({ lyricPlaybackPosition: () => 0.5 }))

const words = [{ text: '歌词', startMs: 0, durationMs: 1000 }]
let animation: { currentTime: number; pause: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }
const animate = vi.fn()
const render = (active = true) => renderToStaticMarkup(<KtvLine words={words} lineStartMs={0} active={active} />)

beforeEach(() => {
  h.reduced = false
  h.enabled = true
  h.deps = h.cleanup = undefined
  animation = { currentTime: 0, pause: vi.fn(), cancel: vi.fn() }
  animate.mockReset().mockReturnValue(animation)
  h.element.querySelectorAll.mockReturnValue([{ animate }])
  vi.stubGlobal('document', { hidden: false })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 42))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { h.cleanup?.(); vi.unstubAllGlobals() })

describe('逐字歌词资源生命周期', () => {
  it.each(['setting', 'reduced'] as const)('%s 运行中关闭后取消逐字动画与帧循环，重新开启可恢复', (mode) => {
    render()
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animation.currentTime).toBe(500)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    if (mode === 'setting') h.enabled = false
    else h.reduced = true
    const plain = render()
    expect(animation.cancel).toHaveBeenCalledTimes(1)
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42)
    expect(plain).not.toContain('aria-hidden="true"')
    expect(plain).toContain('歌词')
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    h.enabled = true
    h.reduced = false
    render()
    expect(animate).toHaveBeenCalledTimes(2)
  })

  it('非当前行不创建逐字动画和帧循环', () => {
    render(false)
    expect(animate).not.toHaveBeenCalled()
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })
})
