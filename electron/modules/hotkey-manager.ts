import { globalShortcut } from 'electron'
import { getMainWindow } from './window-manager'
import type { HotkeyBinding, HotkeyResult, HotkeyOutcome } from '../../src/types/ipc'

const registered = new Map<string, string>()

function triggerAction(action: string): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || !action) return
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
  const results: HotkeyOutcome[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = String(item?.action ?? '').trim()
    const accelerator = String(item?.accelerator ?? '').trim()
    if (!action || !accelerator || seen.has(accelerator)) continue
    seen.add(accelerator)
    let ok = false
    try {
      ok = globalShortcut.register(accelerator, () => triggerAction(action))
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
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留'
        }
      })
    }
  }
  return { ok: true, results }
}
