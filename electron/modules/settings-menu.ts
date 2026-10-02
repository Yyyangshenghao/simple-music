import { Menu, type MenuItemConstructorOptions } from 'electron'
import { getMainWindow } from './window-manager'
import { returnFromMiniPlayer } from './overlay-manager'
import { isSettingsMenuAccelerator, isSystemReservedAccelerator, normalizeAccelerator } from '../../src/lib/shortcuts'

const SETTINGS_MENU_ID = 'simplemusic-settings'

function menuTemplate(items: Electron.MenuItem[]): MenuItemConstructorOptions[] {
  return items.filter((item) => item.id !== SETTINGS_MENU_ID).map((item) => ({
    id: item.id,
    role: item.role,
    type: item.type,
    label: item.label,
    sublabel: item.sublabel,
    toolTip: item.toolTip,
    enabled: item.enabled,
    visible: item.visible,
    checked: item.checked,
    icon: item.icon,
    accelerator: item.accelerator ?? undefined,
    click: (menuItem, window, event) => item.click(menuItem, window, event),
    ...(item.submenu ? { submenu: menuTemplate(item.submenu.items) } : {})
  }))
}

/** 已安装菜单不支持增删；保留既有角色和回调，重建后再安装。 */
export function configureSettingsMenu(value: string): void {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const template = menuTemplate(menu.items)
  const target = template[0]?.submenu
  if (!Array.isArray(target)) return
  const accelerator = normalizeAccelerator(value, process.platform)
  const occupied = (items: Electron.MenuItem[]): boolean => items.some((other) =>
    other.id !== SETTINGS_MENU_ID && ((other.accelerator && normalizeAccelerator(other.accelerator, process.platform) === accelerator)
      || (other.submenu && occupied(other.submenu.items)))
  )
  target.splice(process.platform === 'darwin' ? 1 : 0, 0, {
    id: SETTINGS_MENU_ID,
    label: '设置…',
    accelerator: accelerator && isSettingsMenuAccelerator(accelerator)
      && !isSystemReservedAccelerator(accelerator, process.platform) && !occupied(menu.items) ? accelerator : undefined,
    click: () => {
      returnFromMiniPlayer()
      const win = getMainWindow()
      if (win && !win.isDestroyed()) win.webContents.send('hotkey:triggered', { action: 'settings', source: 'menu' })
    }
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
