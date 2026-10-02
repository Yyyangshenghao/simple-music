import { describe, expect, it, vi } from 'vitest'
import { handleReturnShortcut } from './return-shortcut'

function key(extra: Record<string, unknown> = {}): KeyboardEvent {
  return { key: 'P', code: 'KeyP', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true,
    defaultPrevented: false, repeat: false, isComposing: false, target: { closest: () => null }, preventDefault: vi.fn(), ...extra } as unknown as KeyboardEvent
}
describe('迷你窗口返回快捷键', () => {
  it('默认键及自定义按键精确匹配，调用已有返回主窗口流程', () => {
    const returnMain = vi.fn()
    const event = key()
    handleReturnShortcut(event, 'Command+Shift+P', 'darwin', returnMain)
    expect(returnMain).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    handleReturnShortcut(key({ altKey: true }), 'Command+Shift+P', 'darwin', returnMain)
    expect(returnMain).toHaveBeenCalledOnce()
    handleReturnShortcut(key({ key: 'J', code: 'KeyJ', ctrlKey: true, metaKey: false }), 'Control+Shift+J', 'win32', returnMain)
    expect(returnMain).toHaveBeenCalledTimes(2)
  })
  it('按住按键、输入控件、输入法与已处理的事件不重复切换窗口', () => {
    const returnMain = vi.fn()
    for (const extra of [{ repeat: true }, { target: { closest: () => ({}) } }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
      handleReturnShortcut(key(extra), 'Command+Shift+P', 'darwin', returnMain)
    }
    expect(returnMain).not.toHaveBeenCalled()
  })
  it('清空绑定和系统保留键不拦截系统行为', () => {
    const returnMain = vi.fn()
    const event = key({ key: 'm', code: 'KeyM', shiftKey: false })
    handleReturnShortcut(event, 'Command+M', 'darwin', returnMain)
    handleReturnShortcut(event, '', 'darwin', returnMain)
    expect(returnMain).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
  it('无修饰键留给聚焦按钮和滑杆，组合键仍可用于返回', () => {
    const returnMain = vi.fn()
    const target = { closest: (selector: string) => selector.startsWith('button') ? {} : null }
    const event = key({ key: ' ', code: 'Space', metaKey: false, shiftKey: false, target })
    handleReturnShortcut(event, 'Space', 'darwin', returnMain)
    expect(returnMain).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    handleReturnShortcut(key({ target }), 'Command+Shift+P', 'darwin', returnMain)
    expect(returnMain).toHaveBeenCalledOnce()
  })
})
