import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { returnFromMiniPlayer } from './overlay-manager'

let tray: Tray | null = null

/**
 * 托盘图标。build/icon.png 经 package.json build.files 打进 asar 根，
 * dev 下相对 out/main 回到仓库根，两种环境同一相对路径可用。
 */
function trayImage(): Electron.NativeImage {
  const img = nativeImage.createFromPath(join(import.meta.dirname, '../../build/icon.png'))
  if (img.isEmpty()) return img
  const size = process.platform === 'darwin' ? 18 : 16
  return img.resize({ width: size, height: size })
}

export function createTray(): void {
  if (tray && !tray.isDestroyed()) return
  tray = new Tray(trayImage())
  tray.setToolTip('Simple Music')
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => returnFromMiniPlayer() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  // 左键(win)/单击(mac)回到大播放器；mac 上单击若已弹出菜单则忽略
  tray.on('click', () => returnFromMiniPlayer())
  tray.on('double-click', () => returnFromMiniPlayer())
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}
