import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const h = vi.hoisted(() => ({ on: vi.fn(), remove: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { on: h.on, removeListener: h.remove } }))
import { flushRendererListeningReports } from './listening-flush'

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

function window() {
  const contents = { isDestroyed: () => false, mainFrame: {}, send: vi.fn() }
  const win = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow
  return { contents, win }
}

describe('退出补报握手', () => {
  it('只接受目标主frame及本次请求回执，确认后清理监听', async () => {
    vi.useFakeTimers()
    const { contents, win } = window()
    let finished = false
    const flush = flushRendererListeningReports(win).then(() => { finished = true })
    const id = contents.send.mock.calls[0][1]
    const receive = h.on.mock.calls[0][1]
    receive({ sender: {}, senderFrame: contents.mainFrame }, id)
    receive({ sender: contents, senderFrame: {} }, id)
    receive({ sender: contents, senderFrame: contents.mainFrame }, 'old-request')
    await Promise.resolve()
    expect(finished).toBe(false)
    receive({ sender: contents, senderFrame: contents.mainFrame }, id)
    await flush
    expect(h.remove).toHaveBeenCalledWith('playback:listening-flushed', receive)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('无回执、窗口不存在或发送失败都不会阻塞退出', async () => {
    vi.useFakeTimers()
    await flushRendererListeningReports(null)
    const { contents, win } = window()
    const flush = flushRendererListeningReports(win)
    await vi.advanceTimersByTimeAsync(1800)
    await flush
    expect(h.remove).toHaveBeenCalledOnce()
    contents.send.mockImplementation(() => { throw new Error('closed') })
    await flushRendererListeningReports(win)
    expect(h.remove).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
