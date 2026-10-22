import { describe, it, expect, vi } from 'vitest'
const h = vi.hoisted(() => {
  const frame = { url: 'file:///app/index.html' }
  return { frame, win: { isDestroyed: () => false, webContents: { mainFrame: frame, isDestroyed: () => false } } }
})
vi.mock('electron', () => ({ ipcMain: {} }))
vi.mock('../folium/protocol', () => ({ lyricModManager: vi.fn() }))
vi.mock('../modules/window-manager', () => ({ getMainWindow: () => h.win, resolveRendererUrl: () => 'file:///app/index.html' }))
import { trustedLyricModCaller } from './lyric-mods'

describe('歌词模组 IPC 来源验证', () => {
  it('仅允许主窗口的应用入口主框架', () => {
    const event = { sender: h.win.webContents, senderFrame: h.frame }
    expect(trustedLyricModCaller(event as never)).toBe(true)
    expect(trustedLyricModCaller({ ...event, senderFrame: { url: h.frame.url } } as never)).toBe(false)
    expect(trustedLyricModCaller({ ...event, sender: { ...h.win.webContents } } as never)).toBe(false)
    expect(trustedLyricModCaller({ ...event, senderFrame: null } as never)).toBe(false)
    h.frame.url = 'https://example.com/index.html'
    expect(trustedLyricModCaller(event as never)).toBe(false)
    h.frame.url = 'file:///app/index.html'
  })
})
