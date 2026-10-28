import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { LibraryToolbar } from './LibraryToolbar'

const h = vi.hoisted(() => ({ focus: vi.fn(), focused: false, motion: true, reduced: false }))
vi.mock('motion/react', () => ({ motion: { div: 'div' } }))
vi.mock('../../hooks/useMotion', () => ({ useMotion: () => h.motion }))
vi.mock('../../hooks/useSystemReducedMotion', () => ({ useSystemReducedMotion: () => h.reduced }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: () => [h.focused, (value: boolean) => { h.focused = value }],
  useRef: () => ({ current: { focus: h.focus } }),
}))
type Node = ReactElement<{ children?: ReactNode; 'aria-label'?: string; onClick?(event?: unknown): void; onKeyDown?(event: unknown): void }>
function nodes(node: ReactNode): Node[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child) ? [child as Node, ...nodes(child.props.children)] : [])
}
beforeEach(() => { vi.clearAllMocks(); h.focused = false; h.motion = true; h.reduced = false })

it('清除搜索后保持输入焦点，便于立即输入下一次搜索', () => {
  const onChange = vi.fn()
  const tree = LibraryToolbar({ summary: '1 / 3 首', primary: null, value: '回声', onChange, searchLabel: '搜索伴奏' })
  nodes(tree).find(node => node.props['aria-label'] === '清空搜索伴奏')!.props.onClick!({ stopPropagation: vi.fn() })
  expect(onChange).toHaveBeenCalledWith('')
  expect(h.focus).toHaveBeenCalledOnce()
})

it('搜索区域的图标与留白也能聚焦，锁定搜索时不会错误聚焦', () => {
  const props = { summary: '1 首', primary: null, value: '', onChange: vi.fn(), searchLabel: '搜索伴奏' }
  const surface = (disabled: boolean) => nodes(LibraryToolbar({ ...props, disabled })).find(node => node.type === 'div' && node.props.onClick)!
  surface(false).props.onClick!()
  expect(h.focus).toHaveBeenCalledOnce()
  h.focus.mockClear()
  surface(true).props.onClick!()
  expect(h.focus).not.toHaveBeenCalled()
})

it('Esc 清空搜索，但不能打断中文输入法取消组词', () => {
  const onChange = vi.fn()
  const tree = LibraryToolbar({ summary: '1 首', primary: null, value: '日落', onChange, searchLabel: '搜索伴奏' })
  const field = nodes(tree).find(node => node.props['aria-label'] === '搜索伴奏')!
  const preventDefault = vi.fn()
  const blur = vi.fn()
  field.props.onKeyDown!({ key: 'Escape', nativeEvent: { isComposing: true }, currentTarget: { blur }, preventDefault })
  expect(onChange).not.toHaveBeenCalled()
  expect(preventDefault).not.toHaveBeenCalled()
  expect(blur).not.toHaveBeenCalled()
  field.props.onKeyDown!({ key: 'Escape', nativeEvent: { isComposing: false }, currentTarget: { blur }, preventDefault })
  expect(onChange).toHaveBeenCalledWith('')
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(blur).toHaveBeenCalledOnce()
})

it('聚焦与失焦使用可中断的弹簧展开收起，有内容时保持展开', () => {
  const render = (value = '') => nodes(LibraryToolbar({ summary: '1 首', primary: null, value, onChange: vi.fn(), searchLabel: '搜索伴奏' }))
  const surface = (value = '') => render(value).find(node => node.props.onClick && node.type === 'div')!
  expect(surface().props).toMatchObject({ initial: false, animate: { width: 36 }, transition: { type: 'spring' } })
  const field = () => render().find(node => node.props['aria-label'] === '搜索伴奏')!
  ;(field().props as { onFocus(): void }).onFocus()
  expect(surface().props).toMatchObject({ animate: { width: 280 } })
  ;(field().props as { onBlur(): void }).onBlur()
  expect(surface().props).toMatchObject({ animate: { width: 36 } })
  expect(surface('日落').props).toMatchObject({ animate: { width: 280 } })
})

it.each(['off', 'reduced'])('动效关闭或系统减少动态时即时切换：%s', mode => {
  h.motion = mode !== 'off'
  h.reduced = mode === 'reduced'
  const surface = nodes(LibraryToolbar({ summary: '1 首', primary: null, value: '', onChange: vi.fn(), searchLabel: '搜索伴奏' })).find(node => node.type === 'div' && node.props.onClick)!
  expect(surface.props).toMatchObject({ transition: { duration: 0 } })
})
