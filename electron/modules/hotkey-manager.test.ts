import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ register: vi.fn(), unregister: vi.fn(), send: vi.fn(), restore: vi.fn(), destroyed: false, menu: [] as Array<{ accelerator: string }> }))
vi.mock('electron', () => ({ globalShortcut: { register: h.register, unregister: h.unregister }, Menu: { getApplicationMenu: () => ({ items: h.menu }) } }))
vi.mock('./window-manager', () => ({ getMainWindow: () => ({ isDestroyed: () => h.destroyed, webContents: { send: h.send } }) }))
vi.mock('./overlay-manager', () => ({ returnFromMiniPlayer: h.restore }))
import { configureHotkeys, unregisterHotkeys } from './hotkey-manager'

beforeEach(() => {
  h.register.mockReset().mockReturnValue(true)
  h.unregister.mockClear()
  h.send.mockClear()
  h.restore.mockClear()
  h.destroyed = false
  h.menu = []
})
afterEach(() => {
  unregisterHotkeys()
  vi.unstubAllGlobals()
})

describe('全局快捷键注册', () => {
  it('全局打开设置先恢复完整窗口', () => {
    configureHotkeys([{ action: 'settings', accelerator: 'F10' }])
    h.register.mock.calls[0][1]()
    expect(h.restore).toHaveBeenCalledOnce()
    expect(h.send).toHaveBeenCalledWith('hotkey:triggered', { action: 'settings' })
  })
  it('应用菜单占用的按键返回提示且不抢占', () => {
    h.menu = [{ accelerator: 'CommandOrControl+Q' }]
    const result = configureHotkeys([{ action: 'next', accelerator: 'CommandOrControl+Q' }])
    expect(h.register).not.toHaveBeenCalled()
    expect(result.results[0].conflict?.sourceName).toBe('应用菜单')
    expect(result.menuAccelerators).toHaveLength(1)
  })
  it('注册失败逐行反馈，成功按键触发动作，空配置释放已注册键', () => {
    h.register.mockReturnValueOnce(false).mockReturnValueOnce(true)
    const result = configureHotkeys([{ action: 'prev', accelerator: 'F7' }, { action: 'next', accelerator: 'F8' }])
    expect(result.results.map((item) => item.ok)).toEqual([false, true])
    h.register.mock.calls[1][1]()
    expect(h.send).toHaveBeenCalledWith('hotkey:triggered', { action: 'next' })
    configureHotkeys([])
    expect(h.unregister).toHaveBeenCalledWith('F8')
    expect(h.unregister).not.toHaveBeenCalledWith('F7')
  })
  it('重复别名、单独字母键、未知动作不注册且明确返回失败', () => {
    const results = configureHotkeys([
      { action: 'next', accelerator: 'Ctrl+L' }, { action: 'prev', accelerator: 'Control+L' },
      { action: 'like', accelerator: 'L' }, { action: 'bad', accelerator: 'F9' }
    ]).results
    expect(h.register).toHaveBeenCalledOnce()
    expect(results.map((item) => item.ok)).toEqual([true, false, false, false])
    expect(results[1].conflict?.reason).toContain('其他动作')
  })
  it('非法注册异常不会影响其余按键', () => {
    h.register.mockImplementationOnce(() => { throw new Error('reserved') }).mockReturnValue(true)
    expect(configureHotkeys([{ action: 'prev', accelerator: 'F7' }, { action: 'next', accelerator: 'F8' }]).results.map((item) => item.ok)).toEqual([false, true])
  })
  it.each([
    ['darwin', 'Command+Alt+M'], ['darwin', 'Command+Alt+Space'],
    ['darwin', 'Command+Shift+3'], ['darwin', 'Command+Control+Shift+4'],
    ['win32', 'Super+L'], ['win32', 'Control+Shift+Escape'], ['linux', 'Alt+Tab']
  ])('%s 系统保留键 %s 不送入注册 API', (platform, accelerator) => {
    vi.stubGlobal('process', { ...process, platform })
    const result = configureHotkeys([{ action: 'mini-player', accelerator }])
    expect(h.register).not.toHaveBeenCalled()
    expect(result.results[0].ok).toBe(false)
    expect(result.results[0].conflict?.sourceName).toBe('系统快捷键')
    expect(result.results[0].conflict?.reason).toContain('常见系统快捷键')
  })
})
