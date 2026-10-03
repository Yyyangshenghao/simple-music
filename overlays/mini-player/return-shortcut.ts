import { acceleratorFromEvent, isSystemReservedAccelerator, shouldIgnoreShortcut } from '../../src/lib/shortcuts'

/** 只在迷你窗口获得键盘焦点时响应，应用内按键不注册为系统全局键。 */
export function handleReturnShortcut(event: KeyboardEvent, accelerator: string, platform: string, returnMain: () => void): void {
  if (!accelerator || event.defaultPrevented || event.isComposing || event.keyCode === 229
    || shouldIgnoreShortcut(event.target) || isSystemReservedAccelerator(accelerator, platform)) return
  if (!event.metaKey && !event.ctrlKey && !event.altKey
    && (event.target as Element | null)?.closest?.('button, [role="switch"], [role="slider"]')) return
  if (acceleratorFromEvent(event, platform) !== accelerator) return
  event.preventDefault()
  if (!event.repeat) returnMain()
}
