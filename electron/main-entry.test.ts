import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ helper: false, failLoad: false, runHelper: vi.fn(), loadApplication: vi.fn(), exit: vi.fn() }))
vi.mock('electron', () => ({ app: { exit: h.exit, setName: vi.fn(), setAppUserModelId: vi.fn(), commandLine: { appendSwitch: vi.fn() } } }))
vi.mock('./karaoke-helper', () => ({ isKaraokeHelperProcess: () => h.helper, runKaraokeHelper: h.runHelper }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); h.failLoad = false
  vi.doMock('./application', () => { h.loadApplication(); if (h.failLoad) throw new Error('Load failed'); return {} })
})

describe('应用入口分流', () => {
  it('分离实例启动时不加载播放器及服务端依赖', async () => {
    h.helper = true
    await import('./main')
    await Promise.resolve()
    expect(h.runHelper).toHaveBeenCalledOnce()
    expect(h.loadApplication).not.toHaveBeenCalled()
  })

  it('正常实例加载完整播放器入口', async () => {
    h.helper = false
    await import('./main')
    await vi.waitFor(() => expect(h.loadApplication).toHaveBeenCalledOnce())
    expect(h.runHelper).not.toHaveBeenCalled()
  })

  it('应用模块加载失败时退出，不残留没有窗口的实例', async () => {
    h.helper = false
    h.failLoad = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await import('./main')
      await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(1))
    } finally { log.mockRestore() }
  })
})
