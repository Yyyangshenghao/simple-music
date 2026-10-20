import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent, PointerEvent, MouseEvent } from 'react'
import { useMultiSelection } from './useMultiSelection'

vi.mock('react', () => ({ useEffect: () => {}, useState: (initial: unknown) => [initial, vi.fn()], useRef: (current: unknown) => ({ current }) }))

describe('多选中的应用歌单对话框', () => {
  it('对话框按钮上的 Esc/Ctrl+A、点击与拖动不会穿透底层选区', () => {
    const onExit = vi.fn()
    const selection = useMultiSelection({ enabled: true, keys: ['a'], resetKey: '', onExit })
    const target = { closest: (selector: string) => selector.includes('dialog') ? {} : null }
    for (const key of ['Escape', 'a']) {
      const event = { target, key, ctrlKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() }
      selection.surfaceProps.onKeyDownCapture(event as unknown as KeyboardEvent<HTMLDivElement>)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    const pointer = { target, button: 0, pointerType: 'mouse', preventDefault: vi.fn(), stopPropagation: vi.fn() }
    selection.surfaceProps.onClickCapture(pointer as unknown as MouseEvent<HTMLDivElement>)
    selection.surfaceProps.onPointerDownCapture(pointer as unknown as PointerEvent<HTMLDivElement>)
    expect(pointer.preventDefault).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    const escape = { target: { closest: () => null }, key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() }
    selection.surfaceProps.onKeyDownCapture(escape as unknown as KeyboardEvent<HTMLDivElement>)
    expect(onExit).toHaveBeenCalledOnce()
  })
})
