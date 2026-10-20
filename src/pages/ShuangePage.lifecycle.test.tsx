import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  interface EffectSlot { dependencies?: unknown[]; cleanup?: () => void }
  interface Instance { present: boolean; cursor: number; slots: unknown[]; pending: Array<() => void> }
  const state = { active: false, feed: [{ id: 1, source: 'netease' }], index: 0,
    direction: 1, loading: false, error: null as string | null,
    enter: vi.fn(async () => { state.active = true }),
    leave: vi.fn(() => { state.active = false }),
    next: vi.fn(async () => {}), prev: vi.fn(async () => {}),
    playFullCurrent: vi.fn(), toggleLike: vi.fn(),
  }
  return {
    state, view: 'shuange', current: null as Instance | null,
    instances: [] as Instance[], listeners: new Set<(event: KeyboardEvent) => void>(),
    goBack: vi.fn(), navigateTo: vi.fn(),
    create() {
      const instance: Instance = { present: true, cursor: 0, slots: [], pending: [] }
      this.instances.push(instance)
      return instance
    },
    effect(effect: () => (() => void) | undefined, dependencies?: unknown[]) {
      const instance = this.current!
      const index = instance.cursor++
      const slot = instance.slots[index] as EffectSlot | undefined
      if (slot?.dependencies && dependencies?.every((value, i) => Object.is(value, slot.dependencies![i]))) return
      instance.pending.push(() => {
        slot?.cleanup?.()
        instance.slots[index] = { dependencies, cleanup: effect() }
      })
    },
    unmount(instance: Instance) {
      for (const slot of instance.slots) (slot as EffectSlot)?.cleanup?.()
      instance.slots = []
    },
  }
})

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => {
    const instance = h.current!
    const index = instance.cursor++
    return instance.slots[index] ??= { current }
  },
  useEffect: (effect: () => (() => void) | undefined, dependencies?: unknown[]) => h.effect(effect, dependencies),
}))
vi.mock('motion/react', () => ({ motion: { div: 'div' }, useIsPresent: () => h.current!.present }))
vi.mock('../components/Shuange/ShuangeCard', () => ({ ShuangeCard: () => null }))
vi.mock('../stores/shuange', () => ({ useShuangeStore: Object.assign(
  (selector: (state: typeof h.state) => unknown) => selector(h.state), { getState: () => h.state }
) }))
vi.mock('../stores/navigation', () => ({ useNavigationStore: Object.assign(
  (selector: (state: { currentView: string }) => unknown) => selector({ currentView: h.view }),
  { getState: () => ({ currentView: h.view, history: ['explore'], goBack: h.goBack, navigateTo: h.navigateTo }) }
) }))
vi.mock('../stores/shortcuts', () => ({ useShortcutStore: { getState: () => ({ recording: false }) } }))
vi.mock('../stores/likes', () => ({ useLikesStore: { getState: () => ({ supports: () => true }) } }))

import { ShuangePage } from './ShuangePage'

function render(instance: ReturnType<typeof h.create>) {
  h.current = instance
  instance.cursor = 0
  const page = ShuangePage()
  instance.pending.splice(0).forEach(effect => effect())
  return page
}

beforeEach(() => {
  vi.clearAllMocks()
  h.view = 'shuange'
  h.state.active = true
  h.state.error = null
  h.state.feed = [{ id: 1, source: 'netease' }]
  h.listeners.clear()
  vi.stubGlobal('window', {
    setTimeout, clearTimeout,
    addEventListener: (_name: string, callback: (event: KeyboardEvent) => void) => h.listeners.add(callback),
    removeEventListener: (_name: string, callback: (event: KeyboardEvent) => void) => h.listeners.delete(callback),
  })
  vi.stubGlobal('document', {
    addEventListener: (_name: string, callback: (event: KeyboardEvent) => void) => h.listeners.add(callback),
    removeEventListener: (_name: string, callback: (event: KeyboardEvent) => void) => h.listeners.delete(callback),
  })
})
afterEach(() => {
  h.instances.splice(0).forEach(instance => h.unmount(instance))
  vi.unstubAllGlobals()
})

describe('刷歌页导航生命周期', () => {
  it('界面离页与旧实例卸载不接管宿主的刷歌会话', () => {
    const oldPage = h.create()
    render(oldPage)
    h.view = 'explore'
    oldPage.present = false
    expect(render(oldPage).props['aria-hidden']).toBe(true)
    expect(h.listeners.size).toBe(0)

    h.view = 'shuange'
    const newPage = h.create()
    expect(render(newPage).props['aria-hidden']).toBeUndefined()
    h.unmount(oldPage)
    expect(h.state.enter).not.toHaveBeenCalled()
    expect(h.state.leave).not.toHaveBeenCalled()
    expect(h.state.active).toBe(true)
    expect(h.listeners.size).toBe(2)
  })

  it('已非当前导航时，渲染前的迟到按键也不能操作会话', () => {
    const page = h.create()
    render(page)
    const oldListeners = [...h.listeners]
    h.view = 'playlist'
    for (const key of ['Escape', 'f', 'l', 'ArrowDown']) {
      const event = { key, target: { closest: () => null }, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent
      oldListeners.forEach(listener => listener(event))
    }
    expect(h.state.leave).not.toHaveBeenCalled()
    expect(h.state.next).not.toHaveBeenCalled()
    expect(h.state.playFullCurrent).not.toHaveBeenCalled()
    expect(h.state.toggleLike).not.toHaveBeenCalled()
    expect(h.goBack).not.toHaveBeenCalled()
    render(page)
    expect(h.listeners.size).toBe(0)
  })

  it('快速返回刷歌后退出动画中的旧页保持停用，旧手势和回调不切歌', () => {
    const oldPage = h.create()
    const initial = render(oldPage)
    const oldListeners = [...h.listeners]
    oldPage.present = false
    const inactive = render(oldPage)
    expect(inactive.props.inert).toBe('')
    render(h.create())
    // 即使当前路由重新成为刷歌，退出动画中的旧实例仍然不可交互。
    render(oldPage)
    oldListeners.forEach(listener => listener({ key: 'f', target: { closest: () => null } } as unknown as KeyboardEvent))
    initial.props.children[0].props.children.props.onExit()
    initial.props.children[0].props.onDragEnd({}, { offset: { y: -100 }, velocity: { y: 0 } })
    inactive.props.onWheel({ deltaY: 100 })
    expect(h.state.next).not.toHaveBeenCalled()
    expect(h.state.leave).not.toHaveBeenCalled()
    expect(h.state.playFullCurrent).not.toHaveBeenCalled()
    h.unmount(oldPage)
    expect(h.listeners.size).toBe(2)
  })
})
