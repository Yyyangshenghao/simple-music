import { beforeEach, expect, it, vi } from 'vitest'

type Item = { id?: string; accelerator?: string | null; click?: () => void; submenu?: TestMenu }
type Template = Omit<Item, 'submenu'> & { submenu?: Template[] }
type TestMenu = { items: Item[]; getMenuItemById: (id: string) => Item | null }
const h = vi.hoisted(() => ({ menu: null as TestMenu | null, apply: vi.fn(), send: vi.fn(), restore: vi.fn() }))
vi.mock('electron', () => ({
  Menu: {
    getApplicationMenu: () => h.menu,
    setApplicationMenu: (next: TestMenu) => { h.menu = next; h.apply(next) },
    buildFromTemplate: (items: Template[]): TestMenu => fromTemplate(items)
  }
}))
vi.mock('./window-manager', () => ({ getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: h.send } }) }))
vi.mock('./overlay-manager', () => ({ returnFromMiniPlayer: h.restore }))
import { configureSettingsMenu } from './settings-menu'

function fromTemplate(items: Template[]): TestMenu {
  return menu(items.map(({ submenu, ...item }) => ({
    ...item, ...(submenu ? { submenu: fromTemplate(submenu) } : {})
  })))
}

function menu(items: Item[]): TestMenu {
  return {
    items,
    getMenuItemById(id) {
      for (const item of items) {
        if (item.id === id) return item
        const nested = item.submenu?.getMenuItemById(id)
        if (nested) return nested
      }
      return null
    }
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  h.menu = menu([{ submenu: menu([{ id: 'about' }, { id: 'quit', accelerator: 'CommandOrControl+Q' }]) }])
})

it.each(['darwin', 'win32'])('%s 菜单设置键随配置改变，清除后保留入口及其他原生菜单', (platform) => {
  vi.stubGlobal('process', { ...process, platform })
  try {
    configureSettingsMenu('CommandOrControl+,')
    const item = h.menu!.getMenuItemById('simplemusic-settings')!
    expect(item.accelerator).toBe(platform === 'darwin' ? 'Command+,' : 'Control+,')
    item.click?.()
    expect(h.restore).toHaveBeenCalledOnce()
    expect(h.send).toHaveBeenCalledWith('hotkey:triggered', { action: 'settings', source: 'menu' })
    configureSettingsMenu('F10')
    expect(h.menu!.getMenuItemById('simplemusic-settings')!.accelerator).toBe('F10')
    configureSettingsMenu('')
    expect(h.menu!.getMenuItemById('simplemusic-settings')!.accelerator).toBeUndefined()
    expect(h.menu!.items[0].submenu!.items).toHaveLength(3)
    expect(h.menu!.getMenuItemById('quit')?.accelerator).toBe('CommandOrControl+Q')
    configureSettingsMenu('CommandOrControl+Q')
    expect(h.menu!.getMenuItemById('simplemusic-settings')!.accelerator).toBeUndefined()
    configureSettingsMenu('Shift+A')
    expect(h.menu!.getMenuItemById('simplemusic-settings')!.accelerator).toBeUndefined()
  } finally { vi.unstubAllGlobals() }
})
