import type { HotkeyBinding } from '../types/ipc'

export const SHORTCUT_ACTIONS = [
  { id: 'play-pause', label: '播放 / 暂停', local: 'Space', global: 'CommandOrControl+Alt+Shift+Space' },
  { id: 'prev', label: '上一首', local: 'CommandOrControl+Left', global: 'CommandOrControl+Alt+Shift+Left' },
  { id: 'next', label: '下一首', local: 'CommandOrControl+Right', global: 'CommandOrControl+Alt+Shift+Right' },
  { id: 'volume-up', label: '音量加', local: 'CommandOrControl+Up', global: 'CommandOrControl+Alt+Shift+Up' },
  { id: 'volume-down', label: '音量减', local: 'CommandOrControl+Down', global: 'CommandOrControl+Alt+Shift+Down' },
  { id: 'like', label: '喜欢 / 取消喜欢', local: 'CommandOrControl+L', global: 'CommandOrControl+Alt+Shift+L' },
  { id: 'desktop-lyrics', label: '打开 / 关闭桌面歌词', local: 'CommandOrControl+Shift+L', global: 'CommandOrControl+Alt+Shift+R' },
  { id: 'mini-player', label: '迷你 / 完整模式', local: 'CommandOrControl+Shift+P', global: 'CommandOrControl+Alt+Shift+P' },
  { id: 'settings', label: '打开设置', local: 'CommandOrControl+,', global: '' }
] as const

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]['id']
export type ShortcutScope = 'local' | 'global'

export function isShortcutAction(action: string): action is ShortcutAction {
  return SHORTCUT_ACTIONS.some((item) => item.id === action)
}

export function defaultShortcuts(scope: ShortcutScope): HotkeyBinding[] {
  return SHORTCUT_ACTIONS.map((item) => ({ action: item.id, accelerator: item[scope] }))
}

const MODIFIERS = ['Command', 'Control', 'Alt', 'Shift', 'Super']
const KEY_ALIASES: Record<string, string> = {
  space: 'Space', arrowleft: 'Left', left: 'Left', arrowright: 'Right', right: 'Right',
  arrowup: 'Up', up: 'Up', arrowdown: 'Down', down: 'Down',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', comma: ',', ',': ','
}

/** 只接受录入器支持的按键；统一别名与修饰键顺序，用于注册和冲突比较。 */
export function normalizeAccelerator(value: string, platform: string): string | null {
  const parts = value.split('+').map((part) => part.trim())
  const rawKey = parts.pop() ?? ''
  const key = KEY_ALIASES[rawKey.toLowerCase()]
    ?? (/^[a-z0-9]$/i.test(rawKey) || /^F([1-9]|1\d|2[0-4])$/i.test(rawKey) ? rawKey.toUpperCase() : null)
  if (!key) return null
  const modifiers = new Set<string>()
  for (const part of parts) {
    const name = part.toLowerCase()
    const modifier = name === 'commandorcontrol' || name === 'cmdorctrl'
      ? (platform === 'darwin' ? 'Command' : 'Control')
      : name === 'cmd' || name === 'command' ? 'Command'
        : name === 'ctrl' || name === 'control' ? 'Control'
          : name === 'alt' || name === 'option' ? 'Alt'
            : name === 'shift' ? 'Shift'
              : name === 'super' || name === 'meta' ? (platform === 'darwin' ? 'Command' : 'Super') : null
    if (!modifier || (modifier === 'Command' && platform !== 'darwin')) return null
    modifiers.add(modifier)
  }
  return [...MODIFIERS.filter((name) => modifiers.has(name)), key].join('+')
}

export function isSafeGlobalAccelerator(accelerator: string): boolean {
  return accelerator.includes('+') || /^F([1-9]|1\d|2[0-4])$/.test(accelerator)
}

/** 设置菜单可在输入框中响应，但不能抢占正常字符输入。 */
export function isSettingsMenuAccelerator(accelerator: string): boolean {
  return /^(Command|Control|Alt|Super)\+/.test(accelerator) || /^F([1-9]|1\d|2[0-4])$/.test(accelerator)
}

const MAC_SYSTEM_SHORTCUTS = new Set([
  'Command+M', 'Command+Alt+M', 'Command+H', 'Command+Alt+H',
  'Command+Q', 'Command+Control+Q', 'Command+Shift+Q', 'Command+Alt+Shift+Q',
  'Command+W', 'Command+Alt+W', 'Command+Space', 'Command+Alt+Space', 'Command+Control+Space',
  'Command+Tab', 'Command+Shift+Tab', 'Control+Space', 'Control+Alt+Space',
  'Control+Left', 'Control+Right', 'Control+Up', 'Control+Down', 'Command+Control+F',
  'Command+Shift+3', 'Command+Shift+4', 'Command+Shift+5',
  'Command+Control+Shift+3', 'Command+Control+Shift+4', 'Command+Alt+D', 'Command+Control+Alt+8'
])
const OTHER_SYSTEM_SHORTCUTS = new Set(['Control+Escape', 'Alt+Tab', 'Alt+Shift+Tab', 'Alt+F4'])

/** 避让常见系统组合；系统或其他软件的自定义快捷键仍由注册结果提示。 */
export function isSystemReservedAccelerator(value: string, platform: string): boolean {
  const accelerator = normalizeAccelerator(value, platform)
  if (!accelerator) return false
  return platform === 'darwin' ? MAC_SYSTEM_SHORTCUTS.has(accelerator)
    : accelerator.split('+').includes('Super') || OTHER_SYSTEM_SHORTCUTS.has(accelerator)
      || (platform === 'win32' && accelerator === 'Control+Shift+Escape')
}

type KeyInput = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

export function acceleratorFromEvent(event: KeyInput, platform: string): string | null {
  // Option / Shift 会改变 event.key，字母数字按物理键识别。
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit\d$/.test(event.code) ? event.code.slice(5)
      : event.code === 'Comma' ? ',' : event.code === 'Space' || event.key === ' ' ? 'Space' : event.key
  const modifiers = [
    event.metaKey ? (platform === 'darwin' ? 'Command' : 'Super') : '',
    event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''
  ].filter(Boolean)
  return normalizeAccelerator([...modifiers, key].join('+'), platform)
}

export function formatAccelerator(value: string, platform: string): string {
  if (!value) return '未设置'
  const normalized = normalizeAccelerator(value, platform)
  if (!normalized) return value
  const labels: Record<string, string> = {
    Command: '⌘', Control: platform === 'darwin' ? '⌃' : 'Ctrl',
    Alt: platform === 'darwin' ? '⌥' : 'Alt', Shift: platform === 'darwin' ? '⇧' : 'Shift',
    Super: 'Win', Space: '空格', Left: '←', Right: '→', Up: '↑', Down: '↓'
  }
  return normalized.split('+').map((part) => labels[part] ?? part).join(platform === 'darwin' ? ' ' : ' + ')
}

export function normalizeBindings(value: unknown, defaults: HotkeyBinding[], platform: string): HotkeyBinding[] {
  if (!Array.isArray(value)) return defaults
  return value.filter((item) => item && isShortcutAction(item.action) && typeof item.accelerator === 'string')
    .map((item) => ({ action: item.action, accelerator: normalizeAccelerator(item.accelerator, platform) ?? '' }))
    .filter((item, index, items) => items.findIndex((other) => other.action === item.action) === index)
}

export function bindingConflict(
  action: string, accelerator: string, local: HotkeyBinding[], global: HotkeyBinding[], platform: string
): string | null {
  const normalized = normalizeAccelerator(accelerator, platform)
  if (!normalized) return null
  const conflict = [...local, ...global].find((item) => item.action !== action
    && normalizeAccelerator(item.accelerator, platform) === normalized)
  return SHORTCUT_ACTIONS.find((item) => item.id === conflict?.action)?.label ?? null
}

/** 输入区、原生控件和快捷键录入区保留自己的键盘行为。 */
export function shouldIgnoreShortcut(target: EventTarget | null): boolean {
  if (!target || !('closest' in target) || typeof target.closest !== 'function') return false
  return !!(target as Element).closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-shortcut-recorder]')
}
