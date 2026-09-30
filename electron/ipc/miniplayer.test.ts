import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    returnFromMiniPlayer: vi.fn(() => ({ ok: true })),
    hideMiniPlayerToTray: vi.fn(() => ({ ok: true }))
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      harness.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../modules/overlay-manager', () => ({
  setMiniPlayerEnabled: vi.fn(),
  updateMiniPlayer: vi.fn(),
  moveMiniPlayerBy: vi.fn(),
  resizeMiniPlayerBy: vi.fn(),
  setMiniPlayerPopover: vi.fn(),
  triggerMiniPlayerControl: vi.fn(),
  returnFromMiniPlayer: harness.returnFromMiniPlayer,
  hideMiniPlayerToTray: harness.hideMiniPlayerToTray
}))

import { registerMiniPlayerIpc } from './miniplayer'

describe('迷你播放器 IPC', () => {
  beforeEach(() => {
    harness.handlers.clear()
    harness.returnFromMiniPlayer.mockClear()
    harness.hideMiniPlayerToTray.mockClear()
    registerMiniPlayerIpc()
  })

  it('点击关闭按钮时退出迷你模式并恢复主窗口', () => {
    const close = harness.handlers.get('overlay:miniplayer-close')

    expect(close).toBeTypeOf('function')
    close?.()

    expect(harness.returnFromMiniPlayer).toHaveBeenCalledOnce()
    expect(harness.hideMiniPlayerToTray).not.toHaveBeenCalled()
  })
})
