import { globalShortcut, Menu } from 'electron'
import { getMainWindow } from './window-manager'
import { returnFromMiniPlayer } from './overlay-manager'
import { isShortcutAction, isSafeGlobalAccelerator, isSystemReservedAccelerator, normalizeAccelerator } from '../../src/lib/shortcuts'
import type { HotkeyBinding, HotkeyResult, HotkeyOutcome } from '../../src/types/ipc'

const registered = new Map<string, string>()

function triggerAction(action: string): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || !action) return
  if (action === 'settings') returnFromMiniPlayer()
  win.webContents.send('hotkey:triggered', { action })
}

export function unregisterHotkeys(): void {
  for (const accelerator of registered.keys()) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {
      /* ignore */
    }
  }
  registered.clear()
}

export function configureHotkeys(bindings: HotkeyBinding[]): HotkeyResult {
  unregisterHotkeys()
  const menuAccelerators: string[] = []
  const collect = (items: Electron.MenuItem[]) => {
    for (const item of items) {
      const accelerator = item.accelerator && normalizeAccelerator(item.accelerator, process.platform)
      if (accelerator) menuAccelerators.push(accelerator)
      if (item.submenu) collect(item.submenu.items)
    }
  }
  collect(Menu.getApplicationMenu()?.items ?? [])
  const results: HotkeyOutcome[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = String(item?.action ?? '').trim()
    const rawAccelerator = String(item?.accelerator ?? '').trim()
    if (!rawAccelerator) continue
    const normalized = normalizeAccelerator(rawAccelerator, process.platform)
    const accelerator = normalized ?? rawAccelerator
    const valid = isShortcutAction(action) && !!normalized && isSafeGlobalAccelerator(accelerator)
    const duplicate = seen.has(accelerator)
    const menuReserved = menuAccelerators.includes(accelerator)
    const systemReserved = isSystemReservedAccelerator(accelerator, process.platform)
    if (valid) seen.add(accelerator)
    let ok = false
    try {
      if (valid && !duplicate && !menuReserved && !systemReserved) ok = globalShortcut.register(accelerator, () => triggerAction(action))
    } catch {
      ok = false
    }
    if (ok) {
      registered.set(accelerator, action)
      results.push({ action, accelerator, ok: true })
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: menuReserved ? '应用菜单' : systemReserved ? '系统快捷键' : duplicate ? '应用内重复绑定' : '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: menuReserved ? '该组合键用于应用菜单，请选择其他按键'
            : systemReserved ? '该组合键为常见系统快捷键，请选择其他按键'
            : !valid ? '不支持此全局组合键，请使用修饰键组合或功能键'
            : duplicate ? '该组合键已绑定到其他动作'
              : '该组合键被占用、被系统保留或不受支持'
        }
      })
    }
  }
  return { ok: true, results, menuAccelerators }
}
