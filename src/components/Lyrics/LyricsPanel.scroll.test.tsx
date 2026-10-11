import { isValidElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LyricsPanel } from './LyricsPanel'
import styles from './LyricsPanel.module.css'

type Effect = { deps?: readonly unknown[]; cleanup?: () => void }
const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Effect[],
  pending: [] as Array<() => void>,
  stateCursor: 0, refCursor: 0, effectCursor: 0, dirty: false,
  reducedMotion: false,
  lyrics: { lines: Array.from({ length: 30 }, (_, i) => ({ time: i * 10, text: `歌词 ${i}` })),
    currentIndex: 15, translation: [], romaji: [], wordLines: [], offsetSec: 0, loading: false, source: null },
  settings: { lyricsPanelMode: 'lyrics', performance: { lyrics3dEnabled: true }, lyricsFontScale: 1,
    lyricsLayout: { coverScale: 1, coverX: 0, coverY: 0, lyricsWidth: 56, lyricsX: 0, lyricsY: 0 } },
  seek: vi.fn(),
}))

// 执行组件真实的 effect，并保留依赖、ref 和 state，模拟模式切换时滚动容器的重建。
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (initial: unknown) => h.refs[h.refCursor++] ??= { current: initial },
  useState: (initial: unknown) => {
    const index = h.stateCursor++
    if (index >= h.states.length) h.states[index] = initial
    return [h.states[index], (value: unknown) => {
      const next = typeof value === 'function' ? value(h.states[index]) : value
      if (!Object.is(next, h.states[index])) {
        h.states[index] = next
        h.dirty = true
      }
    }]
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = h.effectCursor++
    const previous = h.effects[index]
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
      h.pending.push(() => {
        previous?.cleanup?.()
        h.effects[index] = { deps, cleanup: effect() || undefined }
      })
    }
  },
}))
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => h.reducedMotion,
}))
vi.mock('../../stores/lyrics', () => ({ useLyricsStore: Object.assign(
  (selector: (state: typeof h.lyrics) => unknown) => selector(h.lyrics), { getState: () => h.lyrics }
) }))
vi.mock('../../stores/player', () => ({ usePlayerStore: Object.assign(
  (selector: (state: object) => unknown) => selector({ currentTrack: null }), { getState: () => ({ seek: h.seek }) }
) }))
vi.mock('../../stores/settings', () => ({ useSettingsStore: (selector: (state: typeof h.settings) => unknown) => selector(h.settings) }))
vi.mock('../../stores/providers', () => ({ useProviderStore: (selector: (state: object) => unknown) => selector({
  byId: { netease: { enabled: false }, qq: { enabled: false } }
}) }))
vi.mock('../../stores/visual', () => ({ useVisualStore: (selector: (state: object) => unknown) => selector({ fx: {} }) }))
vi.mock('../../stores/ambient', () => ({ useAmbientStore: (selector: (state: object) => unknown) => selector({ coverLuma: 0 }) }))

class ScrollContainer {
  clientHeight = 400
  scrollTop = 0
  listeners = new Map<string, () => void>()
  querySelector(selector: string) {
    const index = Number(selector.match(/-?\d+/)?.[0])
    return h.lyrics.lines[index] ? { offsetTop: 200 + index * 80, clientHeight: 40 } : null
  }
  scrollTo = vi.fn(({ top }: { top: number }) => { this.scrollTop = top })
  addEventListener = (type: string, listener: () => void) => { this.listeners.set(type, listener) }
  removeEventListener = (type: string) => { this.listeners.delete(type) }
}

function find(node: unknown, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean)
  if (!isValidElement<Record<string, unknown>>(node)) return
  return predicate(node) ? node : find(node.props.children, predicate)
}

let container: ScrollContainer | null
let tree: ReactElement
let scrollRef: { current: unknown } | undefined
function render(open = true, controlsHidden = false) {
  let iterations = 0
  do {
    if (++iterations > 10) throw new Error('组件反复重渲染')
    h.dirty = false
    h.stateCursor = h.refCursor = h.effectCursor = 0
    tree = LyricsPanel({ open, controlsHidden, onClose: vi.fn() })
    if (h.dirty) {
      h.pending = []
      continue
    }
    const scroll = find(tree, element => String(element.props.className).split(' ').includes(styles.lyricsScroll))
    if (scroll) {
      container ??= new ScrollContainer()
      scrollRef = (scroll as unknown as { ref: { current: unknown } }).ref
      scrollRef.current = container
    } else {
      if (scrollRef) scrollRef.current = null
      container = null
    }
    h.pending.splice(0).forEach(effect => effect())
  } while (h.dirty)
}

function browse(index: number) {
  container!.listeners.get('wheel')!()
  render()
  container!.scrollTop = index * 80
  container!.scrollTo.mockClear()
}
function clickLine(index: number) {
  const line = find(tree, element => element.props['data-line'] === index)!
  const onClick = line.props.onClick as () => void
  onClick()
  render()
}
const center = (index: number) => index * 80 + 20

beforeEach(() => {
  vi.useFakeTimers()
  h.states = []
  h.refs = []
  h.effects = []
  h.pending = []
  h.reducedMotion = false
  h.lyrics.lines = Array.from({ length: 30 }, (_, i) => ({ time: i * 10, text: `歌词 ${i}` }))
  h.lyrics.currentIndex = 15
  h.lyrics.offsetSec = 0
  h.settings.lyricsPanelMode = 'lyrics'
  h.settings.performance.lyrics3dEnabled = true
  h.seek.mockReset().mockImplementation((seconds: number) => {
    h.lyrics.currentIndex = h.lyrics.lines.reduce((index, line, i) => line.time <= seconds + h.lyrics.offsetSec ? i : index, -1)
  })
  container = null
  scrollRef = undefined
})
afterEach(() => {
  h.effects.forEach(effect => effect.cleanup?.())
  vi.useRealTimers()
})

describe('普通歌词定位', () => {
  it.each(['lyrics', '3d'])('%s 设置展开期间不随空闲隐藏，关闭后恢复沉浸', (mode) => {
    h.settings.lyricsPanelMode = mode
    render()
    const trigger = find(tree, element => mode === '3d'
      ? element.props.title === '选择 3D 场景与文字'
      : element.props['aria-label'] === '歌词设置')!
    const toggle = trigger.props.onClick as () => void
    toggle()
    render(true, true)
    expect(tree.props.className).not.toContain(styles.immersive)
    if (mode === '3d') {
      const menu = find(tree, element => typeof element.props.onClose === 'function' && element.props.tab === 'scene')!
      const close = menu.props.onClose as () => void
      close()
    } else {
      toggle()
    }
    render(true, true)
    expect(tree.props.className).toContain(styles.immersive)
  })

  it('系统减少动态时自动跟唱立即定位', () => {
    h.reducedMotion = true
    render()
    container!.scrollTo.mockClear()
    h.lyrics.currentIndex = 18
    render()
    expect(container!.scrollTo).toHaveBeenLastCalledWith({ top: center(18), behavior: 'instant' })
  })

  it('运行时开启减少动态，当前歌词立即结束平滑定位', () => {
    render()
    container!.scrollTo.mockClear()
    h.reducedMotion = true
    render()
    expect(container!.scrollTo).toHaveBeenLastCalledWith({ top: center(15), behavior: 'instant' })
  })

  it.each([true, false])('浏览期间系统减少动态切换为 %s，恢复跟唱采用最新偏好', (reducedMotion) => {
    h.reducedMotion = !reducedMotion
    render()
    browse(23)
    h.reducedMotion = reducedMotion
    render()
    expect(container!.scrollTo).not.toHaveBeenCalled()
    vi.advanceTimersByTime(4000)
    render()
    expect(container!.scrollTo).toHaveBeenLastCalledWith({
      top: center(15), behavior: reducedMotion ? 'instant' : 'smooth'
    })
  })

  it('系统减少动态时点击歌词立即定位', () => {
    h.reducedMotion = true
    render()
    browse(23)
    clickLine(24)
    expect(container!.scrollTo).toHaveBeenLastCalledWith({ top: center(24), behavior: 'instant' })
  })

  it('首次打开定位到正在播放的歌词', () => {
    render()
    expect(container!.scrollTop).toBe(center(15))
  })

  it('浏览后点击同一高亮行也恢复居中，不依赖行号变化', () => {
    render()
    browse(23)
    clickLine(15)
    expect(h.seek).toHaveBeenCalledWith(150.01)
    expect(container!.scrollTop).toBe(center(15))
  })

  it('点击其他歌词按同步偏移跳播，并保持目标行居中', () => {
    render()
    h.lyrics.offsetSec = 1
    browse(23)
    clickLine(24)
    expect(h.seek).toHaveBeenCalledWith(239.01)
    expect(container!.scrollTop).toBe(center(24))
  })

  it.each([false, true])('切回普通歌词恢复当前行，切换前浏览=%s', browsing => {
    render()
    if (browsing) browse(23)
    h.settings.lyricsPanelMode = '3d'
    render()
    h.lyrics.currentIndex = 18
    h.settings.lyricsPanelMode = 'lyrics'
    render()
    expect(container!.scrollTop).toBe(center(18))
    expect(container!.scrollTo).toHaveBeenCalledWith({ top: center(18), behavior: 'instant' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('歌词更新时保留已知播放行，尚未开始时才回到开头', () => {
    render()
    h.lyrics.lines = [...h.lyrics.lines]
    render()
    expect(container!.scrollTop).toBe(center(15))
    h.lyrics.currentIndex = -1
    h.lyrics.lines = [...h.lyrics.lines]
    render()
    expect(container!.scrollTop).toBe(0)
  })

  it('浏览期间不抢滚动，四秒后跟随最新播放行', () => {
    render()
    browse(23)
    h.lyrics.currentIndex = 18
    render()
    expect(container!.scrollTo).not.toHaveBeenCalled()
    vi.advanceTimersByTime(4000)
    render()
    expect(container!.scrollTop).toBe(center(18))
    expect(container!.scrollTo).toHaveBeenLastCalledWith({ top: center(18), behavior: 'smooth' })
  })

  it('关闭并卸载内容后重新打开，仍定位到当前行', () => {
    render()
    browse(23)
    render(false)
    vi.advanceTimersByTime(460)
    render(false)
    h.lyrics.currentIndex = 18
    render()
    expect(container!.scrollTop).toBe(center(18))
  })

  it('快速收起再打开会取消旧浏览计时，并恢复当前行', () => {
    render()
    browse(23)
    render(false)
    render()
    expect(container!.scrollTop).toBe(center(15))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('暂停时歌词加载完成，即使行号未变也恢复当前行', () => {
    h.lyrics.lines = []
    render()
    h.lyrics.lines = Array.from({ length: 30 }, (_, i) => ({ time: i * 10, text: `歌词 ${i}` }))
    render()
    expect(container!.scrollTop).toBe(center(15))
    browse(23)
    expect(container!.listeners.has('wheel')).toBe(true)
  })

  it('禁用 3D 后回落普通歌词，也恢复当前行且保留模式偏好', () => {
    h.settings.lyricsPanelMode = '3d'
    render()
    h.settings.performance.lyrics3dEnabled = false
    render()
    expect(container!.scrollTop).toBe(center(15))
    expect(h.settings.lyricsPanelMode).toBe('3d')
  })
})
