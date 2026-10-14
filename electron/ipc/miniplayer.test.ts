import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    gameEnabled: true,
    setGameMode: vi.fn(),
    setMiniPlayerEnabled: vi.fn<(enabled: boolean, width?: number) => { ok: boolean; error?: string }>(() => ({ ok: true })),
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
  setMiniPlayerEnabled: harness.setMiniPlayerEnabled,
  updateMiniPlayer: vi.fn(),
  moveMiniPlayerBy: vi.fn(),
  resizeMiniPlayerBy: vi.fn(),
  setMiniPlayerPopover: vi.fn(),
  triggerMiniPlayerControl: vi.fn(),
  returnFromMiniPlayer: harness.returnFromMiniPlayer,
  hideMiniPlayerToTray: harness.hideMiniPlayerToTray
}))

vi.mock('../modules/game-mode', () => ({
  getGameMode: () => ({ enabled: harness.gameEnabled }),
  setGameMode: harness.setGameMode
}))

import { registerMiniPlayerIpc } from './miniplayer'

describe('迷你播放器 IPC', () => {
  beforeEach(() => {
    harness.handlers.clear()
    harness.gameEnabled = true
    harness.setGameMode.mockClear()
    harness.setMiniPlayerEnabled.mockReset().mockReturnValue({ ok: true })
    harness.returnFromMiniPlayer.mockClear()
    harness.hideMiniPlayerToTray.mockClear()
    registerMiniPlayerIpc()
  })

  it('后台失联后拒绝迟到的开启请求，保留游戏模式且不恢复主窗口', () => {
    const failure = { ok: false, error: '播放后台已停止，请重启应用' }
    harness.setMiniPlayerEnabled.mockReturnValue(failure)
    const result = harness.handlers.get('miniplayer:set-enabled')?.({}, { enabled: true })
    expect(result).toEqual(failure)
    expect(harness.setGameMode).not.toHaveBeenCalled()
  })

  it('成功开启迷你条才退出游戏模式，不额外恢复主窗口', () => {
    const result = harness.handlers.get('miniplayer:set-enabled')?.({}, { enabled: true, width: 360 })
    expect(result).toEqual({ ok: true })
    expect(harness.setMiniPlayerEnabled).toHaveBeenCalledWith(true, 360)
    expect(harness.setGameMode).toHaveBeenCalledWith({ enabled: false }, false)
  })

  it('点击关闭按钮时退出迷你模式并恢复主窗口', () => {
    const close = harness.handlers.get('overlay:miniplayer-close')

    expect(close).toBeTypeOf('function')
    close?.()

    expect(harness.returnFromMiniPlayer).toHaveBeenCalledOnce()
    expect(harness.hideMiniPlayerToTray).not.toHaveBeenCalled()
  })
})
