import { describe, expect, it, vi } from 'vitest'
import { blockKeyboardControl } from './keyboard-controls'

function key(extra: Record<string, unknown> = {}): KeyboardEvent {
  return {
    key: 'Enter', code: 'Enter', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false, isComposing: false, target: null,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra
  } as unknown as KeyboardEvent
}

describe('普通控件的键盘隔离', () => {
  it.each(['Enter', 'Tab', ' ', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'f'])('%s 不交给普通控件或页面', (pressed) => {
    const event = key({ key: pressed, code: pressed === ' ' ? 'Space' : pressed })
    blockKeyboardControl(event, 'darwin')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it.each([' ', 'Enter', 'ArrowLeft', 'Backspace'])('文字输入保留 %s，Tab 不移动焦点', (pressed) => {
    const target = { closest: (selector: string) => selector.includes('textarea') ? {} : null }
    const event = key({ key: pressed, target })
    blockKeyboardControl(event, 'darwin')
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
    const tab = key({ key: 'Tab', code: 'Tab', target })
    blockKeyboardControl(tab, 'darwin')
    expect(tab.preventDefault).toHaveBeenCalledOnce()
    expect(tab.stopPropagation).toHaveBeenCalledOnce()
  })

  it('已执行快捷键的事件不再传给控件，也不重复取消默认行为', () => {
    const event = key({ defaultPrevented: true })
    blockKeyboardControl(event, 'darwin')
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it.each([
    ['darwin', { key: 'Tab', code: 'Tab', metaKey: true }],
    ['win32', { key: 'F4', code: 'F4', altKey: true }],
    ['win32', { key: 'l', code: 'KeyL', metaKey: true }]
  ])('%s 保留系统快捷键', (platform, extra) => {
    const event = key(extra)
    blockKeyboardControl(event, platform)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  it.each([{ isComposing: true }, { keyCode: 229 }])('不干扰输入法组合态 %j', (extra) => {
    const event = key(extra)
    blockKeyboardControl(event, 'darwin')
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })
})
