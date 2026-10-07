import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const h = vi.hoisted(() => ({ cleanups: [] as Array<() => void>, listeners: [] as Array<{ capture: boolean; callback: (event: KeyboardEvent) => void }> }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => (() => void) | undefined) => { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup) },
}))
vi.mock('../hooks/useShuangePlayer', () => ({ useShuangePlayer: () => {} }))
vi.mock('../stores/shuange', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/shuange')>()
  const store = original.useShuangeStore
  return { ...original, useShuangeStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store
  ) }
})
import { useShuangeStore } from '../stores/shuange'
import { useShortcutStore } from '../stores/shortcuts'
import { useLikesStore } from '../stores/likes'
import { usePlayerStore } from '../stores/player'
import { ShuangePage } from './ShuangePage'

const initial = useShuangeStore.getState()
const track = { id: 1, source: 'netease', name: '测试歌曲', artists: [] } as unknown as Track
function key(extra: Record<string, unknown> = {}) {
  return { key: 'ArrowDown', target: { closest: () => null }, defaultPrevented: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra } as unknown as KeyboardEvent
}
function capture(event: KeyboardEvent) {
  h.listeners.filter(listener => listener.capture).forEach(listener => listener.callback(event))
}
beforeEach(() => {
  vi.useFakeTimers()
  h.listeners.length = 0
  useShortcutStore.setState({ recording: false })
  useShuangeStore.setState({ active: true, index: 1, feed: [track, track], next: vi.fn(async () => {}), prev: vi.fn(async () => {}),
    leave: vi.fn(), playFullCurrent: vi.fn(), toggleLike: vi.fn(async () => {}) })
  vi.stubGlobal('window', {
    setTimeout, clearTimeout,
    addEventListener: (_type: string, callback: (event: KeyboardEvent) => void, capture = false) => h.listeners.push({ capture, callback }),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('document', {
    addEventListener: (_type: string, callback: (event: KeyboardEvent) => void, capture = false) => h.listeners.push({ capture, callback }),
    removeEventListener: vi.fn(),
  })
  ShuangePage()
})
afterEach(() => {
  h.cleanups.splice(0).forEach(cleanup => cleanup())
  useShuangeStore.setState(initial, true)
  useShortcutStore.setState({ recording: false })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('爽歌键盘与主窗口导航拦截协作', () => {
  it('聚焦按钮时，上下键在控件处理前消费，只切换一首', () => {
    const down = key()
    capture(down)
    expect(down.preventDefault).toHaveBeenCalledOnce()
    expect(down.stopPropagation).toHaveBeenCalledOnce()
    expect(useShuangeStore.getState().next).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(300)
    capture(key({ key: 'ArrowUp' }))
    expect(useShuangeStore.getState().prev).toHaveBeenCalledOnce()
  })
  it('按住方向键不连续切歌，也不把重复按键交给控件导航', () => {
    const event = key({ repeat: true })
    capture(event)
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(useShuangeStore.getState().next).not.toHaveBeenCalled()
  })
  it('已被主窗口快捷键消费、输入区、输入法及修饰组合不切歌', () => {
    for (const extra of [{ defaultPrevented: true }, { target: { closest: () => ({}) } }, { isComposing: true },
      { keyCode: 229 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const event = key(extra)
      capture(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    useShortcutStore.setState({ recording: true })
    capture(key())
    expect(useShuangeStore.getState().next).not.toHaveBeenCalled()
  })
  it('空格统一交给主窗口快捷键，不再由爽歌页切换第二次', () => {
    const toggle = vi.spyOn(usePlayerStore.getState(), 'toggle')
    h.listeners.filter(listener => !listener.capture).forEach(listener => listener.callback(key({ key: ' ' })))
    expect(toggle).not.toHaveBeenCalled()
  })
  it('Shift+F 和 Shift+L 保留原有完整播放与喜欢操作', () => {
    vi.spyOn(useLikesStore.getState(), 'supports').mockReturnValue(true)
    const listener = h.listeners.find(listener => !listener.capture)!
    listener.callback(key({ key: 'F', shiftKey: true }))
    listener.callback(key({ key: 'L', shiftKey: true }))
    expect(useShuangeStore.getState().playFullCurrent).toHaveBeenCalledOnce()
    expect(useShuangeStore.getState().toggleLike).toHaveBeenCalledWith(track)
  })
})
