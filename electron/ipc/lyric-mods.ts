import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { getMainWindow, resolveRendererUrl } from '../modules/window-manager'
import { lyricModManager } from '../folium/protocol'

export function trustedLyricModCaller(event: IpcMainInvokeEvent): boolean {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.sender.isDestroyed()
    || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false
  try {
    const url = new URL(event.senderFrame.url)
    const expected = new URL(resolveRendererUrl('index.html'))
    url.hash = ''
    expected.hash = ''
    return url.href === expected.href
  } catch { return false }
}

export function registerLyricModIpc(): void {
  const trusted = (event: IpcMainInvokeEvent) => {
    if (!trustedLyricModCaller(event)) throw new Error('不允许此页面操作歌词模组')
  }
  ipcMain.handle('lyric-mods:catalog', event => { trusted(event); return lyricModManager().getCatalog() })
  ipcMain.handle('lyric-mods:list', event => { trusted(event); return lyricModManager().list() })
  ipcMain.handle('lyric-mods:install', (event, id: string) => { trusted(event); return lyricModManager().install(id) })
  ipcMain.handle('lyric-mods:remove', (event, id: string) => { trusted(event); return lyricModManager().remove(id) })
}
