import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HoverTips } from './HoverTips'

const h = vi.hoisted(() => ({ refs: [] as { current: unknown }[], states: [] as unknown[], mutations: null as (() => void) | null, observe: vi.fn(), disconnect: vi.fn(), expanded: false, effects: [] as (() => (() => void) | undefined)[] }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useId: () => 'hover-tip-test',
  useRef: (current: unknown) => { const ref = { current }; h.refs.push(ref); return ref },
  useState: (initial: unknown) => { const index = h.states.length; h.states.push(initial); return [initial, (value: unknown) => { h.states[index] = value }] },
  useEffect: (effect: () => (() => void) | undefined) => h.effects.push(effect),
  useLayoutEffect: () => {},
}))
vi.mock('../../hooks/useMotion', () => ({ useMotion: () => true }))
vi.mock('../../hooks/useSystemReducedMotion', () => ({ useSystemReducedMotion: () => false }))
vi.mock('motion/react', () => ({
  AnimatePresence: 'div', motion: { div: 'div', span: 'span' },
  useMotionValue: (initial: unknown) => ({ get: () => initial, jump: vi.fn() }),
  useTransform: () => ({}),
  // 即使旧动画被 stop 后仍完成 Promise，也不能清除新提示。
  animate: () => ({ stop: vi.fn(), finished: new Promise<void>(resolve => setTimeout(resolve, 128)) }),
}))

class Button {
  dataset: { tip?: string } = {}
  disabled = false
  isConnected = true
  attrs = new Map<string, string>()
  constructor(text: string) { this.dataset.tip = text }
  closest() { return this }
  getAttribute(key: string) { return this.attrs.get(key) ?? null }
  setAttribute(key: string, value: string) { this.attrs.set(key, value) }
  removeAttribute(key: string) { this.attrs.delete(key) }
  getBoundingClientRect() { return { left: 20, top: 10, bottom: 42, width: 32 } }
}
const hostListeners = new Map<string, (event?: unknown) => void>()
const windowListeners = new Map<string, (event?: unknown) => void>()
let cleanup: (() => void) | undefined
const over = (button: Button) => hostListeners.get('pointerover')!({ target: button, pointerType: 'mouse', buttons: 0 })
const tip = () => h.states[1] as { text: string } | null

beforeEach(() => {
  vi.useFakeTimers()
  h.refs = []; h.states = []; h.effects = []
  hostListeners.clear(); windowListeners.clear()
  h.mutations = null; h.expanded = false; h.observe.mockClear(); h.disconnect.mockClear()
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { h.mutations = callback }
    observe = h.observe
    disconnect = h.disconnect
  })
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: () => void) => windowListeners.set(name, listener),
    removeEventListener: (name: string) => windowListeners.delete(name),
  })
  HoverTips({})
  h.refs[0].current = { parentElement: {
    contains: () => true, querySelector: () => h.expanded ? {} : null,
    addEventListener: (name: string, listener: () => void) => hostListeners.set(name, listener),
    removeEventListener: (name: string) => hostListeners.delete(name),
  } }
  cleanup = h.effects[0]()
})
afterEach(() => { cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('短暂经过不弹提示，出现后关联按钮，滚动立即收起并清理关联', () => {
  const button = new Button('设置')
  over(button)
  vi.advanceTimersByTime(349)
  expect(tip()).toBeNull()
  vi.advanceTimersByTime(1)
  expect(tip()?.text).toBe('设置')
  expect(button.getAttribute('aria-describedby')).toBe('hover-tip-test')
  windowListeners.get('scroll')!()
  expect(tip()).toBeNull()
  expect(button.getAttribute('aria-describedby')).toBeNull()
})

it('退出动画尚未结束时移到相邻按钮，旧动画完成也不会误清新提示', async () => {
  over(new Button('刷新'))
  vi.advanceTimersByTime(350)
  hostListeners.get('pointerleave')!()
  vi.advanceTimersByTime(110)
  over(new Button('设置'))
  await vi.advanceTimersByTimeAsync(500)
  expect(tip()?.text).toBe('设置')
})

it('移到没有提示内容的控件，不残留上一个控件的提示', () => {
  over(new Button('刷新'))
  vi.advanceTimersByTime(350)
  over(new Button(''))
  expect(tip()).toBeNull()
})

it('禁用按钮保留原因，悬停期间原生 title 变化后不会写回旧值', () => {
  const button = new Button('下一首播放')
  button.disabled = true
  button.setAttribute('title', '单曲循环时不会自动切歌')
  over(button)
  vi.advanceTimersByTime(350)
  expect(tip()?.text).toBe('单曲循环时不会自动切歌')
  button.removeAttribute('title')
  hostListeners.get('pointerleave')!()
  expect(button.getAttribute('title')).toBeNull()
})

it('卸载取消延迟出现的提示并移除监听，不覆盖原有描述', () => {
  const button = new Button('设置')
  button.setAttribute('aria-describedby', 'existing-help')
  over(button)
  cleanup?.()
  cleanup = undefined
  vi.advanceTimersByTime(500)
  expect(tip()).toBeNull()
  expect(button.getAttribute('aria-describedby')).toBe('existing-help')
  expect(hostListeners.size).toBe(0)
  expect(windowListeners.size).toBe(0)
})

it('鼠标不移动时文案也随按钮状态更新，保留同一个按钮的描述关联', () => {
  const button = new Button('暂停队列')
  over(button)
  vi.advanceTimersByTime(350)
  button.dataset.tip = '继续队列'
  h.mutations?.()
  expect(tip()?.text).toBe('继续队列')
  expect(button.getAttribute('aria-describedby')).toBe('hover-tip-test')
})

it('当前按钮被移除或面板展开，旧提示立即收起', () => {
  const button = new Button('移除任务')
  over(button)
  vi.advanceTimersByTime(350)
  button.isConnected = false
  h.mutations?.()
  expect(tip()).toBeNull()
  const next = new Button('设置')
  over(next)
  vi.advanceTimersByTime(350)
  h.expanded = true
  h.mutations?.()
  expect(tip()).toBeNull()
})

it('只在有悬停目标时监听内容变化，离开和卸载后释放', () => {
  expect(h.observe).not.toHaveBeenCalled()
  over(new Button('设置'))
  expect(h.observe).toHaveBeenCalledOnce()
  hostListeners.get('pointerleave')!()
  expect(h.disconnect).toHaveBeenCalled()
})
