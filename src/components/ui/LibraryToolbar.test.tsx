import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { LibraryToolbar } from './LibraryToolbar'

const h = vi.hoisted(() => ({ focus: vi.fn() }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: () => ({ current: { focus: h.focus } }),
}))
type Node = ReactElement<{ children?: ReactNode; 'aria-label'?: string; onClick?(event?: unknown): void; onKeyDown?(event: unknown): void }>
function nodes(node: ReactNode): Node[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child) ? [child as Node, ...nodes(child.props.children)] : [])
}
beforeEach(() => vi.clearAllMocks())

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
  field.props.onKeyDown!({ key: 'Escape', nativeEvent: { isComposing: true }, preventDefault })
  expect(onChange).not.toHaveBeenCalled()
  expect(preventDefault).not.toHaveBeenCalled()
  field.props.onKeyDown!({ key: 'Escape', nativeEvent: { isComposing: false }, preventDefault })
  expect(onChange).toHaveBeenCalledWith('')
  expect(preventDefault).toHaveBeenCalledOnce()
})
