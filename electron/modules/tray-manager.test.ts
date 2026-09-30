import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  events: new Map<string, () => void>(),
  restore: vi.fn(), destroy: vi.fn(), quit: vi.fn(), buildMenu: vi.fn(),
}))
vi.mock('electron', () => ({
  Tray: vi.fn(function () {
    return {
      isDestroyed: () => false, destroy: h.destroy,
      setToolTip: vi.fn(), setContextMenu: vi.fn(),
      on: (event: string, callback: () => void) => h.events.set(event, callback),
    }
  }),
  Menu: { buildFromTemplate: h.buildMenu },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  app: { quit: h.quit },
}))
vi.mock('./overlay-manager', () => ({ returnFromMiniPlayer: h.restore }))

import { createTray, destroyTray } from './tray-manager'

describe('托盘恢复迷你模式', () => {
  beforeEach(() => {
    destroyTray()
    vi.clearAllMocks()
    h.events.clear()
    createTray()
  })

  it.each(['click', 'double-click'])('%s 统一退出迷你模式并恢复主窗口', (event) => {
    h.events.get(event)!()
    expect(h.restore).toHaveBeenCalledOnce()
  })

  it('显示主窗口菜单走同一恢复路径，退出菜单真正退出应用', () => {
    const items = h.buildMenu.mock.calls[0][0] as Electron.MenuItemConstructorOptions[]
    const show = items.find((item) => item.label === '显示主窗口')!
    const quit = items.find((item) => item.label === '退出')!
    const showWindow = show.click as () => void
    const quitApp = quit.click as () => void
    showWindow()
    quitApp()
    expect(h.restore).toHaveBeenCalledOnce()
    expect(h.quit).toHaveBeenCalledOnce()
  })

  it('重复创建不重复注册监听，销毁后可重新创建', () => {
    createTray()
    expect(h.buildMenu).toHaveBeenCalledOnce()
    destroyTray()
    createTray()
    expect(h.destroy).toHaveBeenCalledOnce()
    expect(h.buildMenu).toHaveBeenCalledTimes(2)
  })
})
