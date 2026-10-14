import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handle: vi.fn(),
  main: { webContents: { mainFrame: { url: 'file:///playback-host.html' }, executeJavaScript: vi.fn(async () => undefined) } },
  captureFrame: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: h.handle } }))
vi.mock('../modules/playback-host', () => ({ getPlaybackHost: () => h.main, isPlaybackHostEvent: (event: any) => event.sender === h.main.webContents && event.senderFrame === h.main.webContents.mainFrame }))
vi.mock('../server-host', () => ({ getAppleMusicCaptureFrame: h.captureFrame }))

import { registerAppleAudioIpc } from './apple-audio'

describe('Apple Music 音频捕获入口', () => {
  beforeEach(() => { vi.clearAllMocks(); h.captureFrame.mockReturnValue({ id: 'apple' }); registerAppleAudioIpc() })

  it('后台宿主触发带用户手势的捕获事件', async () => {
    const handler = h.handle.mock.calls[0][1]
    await expect(handler({ sender: h.main.webContents, senderFrame: h.main.webContents.mainFrame })).resolves.toBe(true)
    expect(h.main.webContents.executeJavaScript).toHaveBeenCalledWith(
      "window.dispatchEvent(new Event('simplemusic:apple-audio-capture'))", true
    )
  })

  it('其它窗口或没有应用内 Apple 播放窗口时拒绝', async () => {
    const handler = h.handle.mock.calls[0][1]
    await expect(handler({ sender: {} })).resolves.toBe(false)
    h.captureFrame.mockReturnValue(null)
    await expect(handler({ sender: h.main.webContents, senderFrame: h.main.webContents.mainFrame })).resolves.toBe(false)
    expect(h.main.webContents.executeJavaScript).not.toHaveBeenCalled()
  })
})
