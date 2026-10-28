import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Select, selectPosition } from './Select'

const h = vi.hoisted(() => ({ open: true, setters: [] as unknown[], state: 0, grow: true, effects: [] as (() => unknown)[] }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useId: () => 'select-test',
  useRef: () => ({ current: { getBoundingClientRect: () => ({ left: 8, top: 8, bottom: 40, width: 120 }), contains: () => false, closest: () => null, matches: () => true } }),
  useState: () => h.state++ % 2 === 0 ? [h.open, (value: unknown) => h.setters.push(value)] : [{ left: 8, top: 40, width: 176, maxHeight: 120 }, vi.fn()],
  useEffect: () => {}, useLayoutEffect: (effect: () => unknown) => { h.effects.push(effect) },
}))
vi.mock('react-dom', () => ({ createPortal: (node: ReactNode) => node }))
vi.mock('motion/react', () => ({ motion: { div: 'div', svg: 'svg' }, AnimatePresence: 'div' }))
vi.mock('../../hooks/useMotion', () => ({ useMotion: () => h.grow }))
vi.mock('../../hooks/useSystemReducedMotion', () => ({ useSystemReducedMotion: () => false }))
type Node = ReactElement<Record<string, any>>
function nodes(node: ReactNode): Node[] {
  return Children.toArray(node).flatMap(child => isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : [])
}
beforeEach(() => { h.open = true; h.state = 0; h.grow = true; h.setters = []; h.effects = []; vi.stubGlobal('document', { body: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() }); vi.stubGlobal('window', { innerWidth: 960, innerHeight: 540, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
afterEach(() => vi.unstubAllGlobals())
const options = [{ value: 'first', label: '第一项' }, { value: 'second', label: '第二项', disabled: true }]
const render = (onChange = vi.fn(), disabled = false) => nodes(Select({ value: 'first', options, onChange, 'aria-label': '排序', disabled }))
it('选中项明确标记，禁用选项不会写入业务状态', () => {
  const change = vi.fn()
  const rows = render(change).filter(node => node.props.role === 'option')
  expect(rows[0].props['aria-selected']).toBe(true)
  expect(rows[1].props.disabled).toBe(true)
  rows[1].props.onClick()
  expect(change).not.toHaveBeenCalled()
  rows[0].props.onClick()
  expect(change).toHaveBeenCalledWith('first')
  expect(h.setters).toContain(false)
})
it('禁用控件不显示选项；浮层使用 top layer 避免模态窗口裁剪', () => {
  expect(render(vi.fn(), true).some(node => node.props.role === 'listbox')).toBe(false)
  expect(render().find(node => node.props.role === 'listbox')!.props.popover).toBe('manual')
})
it('弹层动效开关控制真实过渡', () => {
  expect(render().find(node => node.props.role === 'listbox')!.props.transition.type).toBe('spring')
  h.grow = false
  expect(render().find(node => node.props.role === 'listbox')!.props.transition.duration).toBe(0)
})
it('底部空间不足向上展开，并避免右侧越界', () => {
  const pos = selectPosition({ left: 930, top: 480, bottom: 512, width: 120 }, { width: 960, height: 540 }, 8)
  expect(pos.upwards).toBe(true)
  expect(pos.left + pos.width).toBeLessThanOrEqual(952)
  expect(pos.top).toBeGreaterThanOrEqual(8)
  expect(pos.top + pos.maxHeight).toBeLessThan(480)
})
it('长列表限制高度，窗口窄时不横向溢出', () => {
  const pos = selectPosition({ left: 8, top: 20, bottom: 52, width: 400 }, { width: 320, height: 540 }, 100)
  expect(pos.width).toBe(304)
  expect(pos.maxHeight).toBe(260)
  expect(pos.upwards).toBe(false)
})

it('Esc 在 window 捕获阶段关闭，退出清理所有监听，重开恢复点击', () => {
  const tree = render()
  const cleanup = h.effects[0]() as () => void
  const listener = vi.mocked(window.addEventListener).mock.calls.find(call => call[0] === 'keydown')!
  expect(listener[2]).toBe(true)
  const event = { key: 'Escape', isComposing: false, preventDefault: vi.fn(), stopPropagation: vi.fn() }
  ;(listener[1] as (event: unknown) => void)(event)
  expect(h.setters).toContain(false)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(tree.find(node => node.props.role === 'listbox')!.props.animate.pointerEvents).toBe('auto')
  cleanup()
  expect(window.removeEventListener).toHaveBeenCalledWith('keydown', listener[1], true)
  expect(document.removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function))
})
