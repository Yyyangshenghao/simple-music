import { describe, expect, it } from 'vitest'
import { acceleratorFromEvent, bindingConflict, defaultShortcuts, formatAccelerator, normalizeAccelerator, normalizeBindings, isSafeGlobalAccelerator, isSystemReservedAccelerator, shouldIgnoreShortcut } from './shortcuts'

describe('快捷键录入与冲突', () => {
  it.each(['darwin', 'win32'])('%s 设置快捷键支持逗号键与平台显示', (platform) => {
    expect(normalizeAccelerator('CommandOrControl+Comma', platform)).toBe(platform === 'darwin' ? 'Command+,' : 'Control+,')
    expect(formatAccelerator('CommandOrControl+,', platform)).toBe(platform === 'darwin' ? '⌘ ,' : 'Ctrl + ,')
    expect(acceleratorFromEvent({ key: '，', code: 'Comma', metaKey: platform === 'darwin', ctrlKey: platform === 'win32', altKey: false, shiftKey: false }, platform)).toBe(platform === 'darwin' ? 'Command+,' : 'Control+,')
    expect(defaultShortcuts('local').find((item) => item.action === 'settings')?.accelerator).toBe('CommandOrControl+,')
    expect(defaultShortcuts('global').find((item) => item.action === 'settings')?.accelerator).toBe('')
  })
  it('按平台统一别名、修饰键顺序，并保留精确的修饰键组合', () => {
    expect(normalizeAccelerator('alt+CmdOrCtrl+ArrowLeft', 'darwin')).toBe('Command+Alt+Left')
    expect(normalizeAccelerator('shift+CommandOrControl+L', 'win32')).toBe('Control+Shift+L')
    expect(normalizeAccelerator('Command+L', 'win32')).toBeNull()
    expect(normalizeAccelerator('Control++L', 'win32')).toBeNull()
    expect(formatAccelerator('CommandOrControl+Alt+Space', 'darwin')).toBe('⌘ ⌥ 空格')
  })
  it('macOS Option 导致字符变化时仍能录入原来的字母键', () => {
    expect(acceleratorFromEvent({ key: '¬', code: 'KeyL', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false }, 'darwin')).toBe('Command+Alt+L')
    expect(acceleratorFromEvent({ key: 'Shift', code: 'ShiftLeft', metaKey: false, ctrlKey: false, altKey: false, shiftKey: true }, 'win32')).toBeNull()
  })
  it('跨作用域检查同键不同动作，同一动作可以在两个作用域共用按键', () => {
    const local = defaultShortcuts('local')
    expect(bindingConflict('prev', 'Ctrl+L', local, [], 'win32')).toBe('喜欢 / 取消喜欢')
    expect(bindingConflict('like', 'Ctrl+L', local, [], 'win32')).toBeNull()
    expect(isSafeGlobalAccelerator('Space')).toBe(false)
    expect(isSafeGlobalAccelerator('F8')).toBe(true)
  })
  it('加载时丢弃未知动作和不支持的按键，保留主动清除的空列表', () => {
    expect(normalizeBindings([{ action: 'unknown', accelerator: 'F1' }, { action: 'next', accelerator: 'MediaNextTrack' }], [], 'darwin')).toEqual([{ action: 'next', accelerator: '' }])
    expect(normalizeBindings([], defaultShortcuts('global'), 'win32')).toEqual([])
  })
  it('嵌套可编辑区和录入区避让', () => {
    const closest = (selector: string) => selector.includes('contenteditable') ? {} : null
    expect(shouldIgnoreShortcut({ closest } as unknown as EventTarget)).toBe(true)
    expect(shouldIgnoreShortcut(null)).toBe(false)
  })
  it.each(['darwin', 'win32', 'linux'])('%s 默认按键避开已知系统组合，迷你模式使用 P', (platform) => {
    for (const scope of ['local', 'global'] as const) {
      const bindings = defaultShortcuts(scope)
      expect(bindings.every((item) => !isSystemReservedAccelerator(item.accelerator, platform))).toBe(true)
      expect(bindings.find((item) => item.action === 'mini-player')?.accelerator).toBe(
        scope === 'local' ? 'CommandOrControl+Shift+P' : 'CommandOrControl+Alt+Shift+P'
      )
    }
  })
  it('系统组合按平台与精确修饰键识别，不误拒新增默认组合', () => {
    for (const accelerator of [
      'Cmd+M', 'Option+Cmd+M', 'Cmd+Space', 'Cmd+Alt+Space', 'Ctrl+Cmd+Space', 'Ctrl+Right', 'Cmd+Shift+Tab',
      'Cmd+Shift+3', 'Cmd+Shift+4', 'Cmd+Shift+5', 'Ctrl+Cmd+Shift+3', 'Ctrl+Cmd+Shift+4',
      'Cmd+Alt+D', 'Ctrl+Alt+Cmd+8'
    ]) {
      expect(isSystemReservedAccelerator(accelerator, 'darwin')).toBe(true)
    }
    for (const platform of ['win32', 'linux']) {
      for (const accelerator of ['Super+L', 'Super+Shift+S', 'Ctrl+Esc', 'Alt+Tab', 'Alt+Shift+Tab', 'Alt+F4']) {
        expect(isSystemReservedAccelerator(accelerator, platform)).toBe(true)
      }
    }
    expect(isSystemReservedAccelerator('Ctrl+M', 'win32')).toBe(false)
    expect(isSystemReservedAccelerator('Ctrl+Shift+Esc', 'win32')).toBe(true)
    expect(isSystemReservedAccelerator('Ctrl+Shift+Esc', 'darwin')).toBe(false)
    expect(isSystemReservedAccelerator('Cmd+Alt+Shift+Space', 'darwin')).toBe(false)
    expect(isSystemReservedAccelerator('Cmd+Shift+P', 'darwin')).toBe(false)
  })
})
