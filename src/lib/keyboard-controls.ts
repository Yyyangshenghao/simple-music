import { acceleratorFromEvent, isSystemReservedAccelerator, shouldIgnoreShortcut } from './shortcuts'

/** 快捷键处理后调用；文字输入保留编辑行为，其余控件只接受鼠标操作。 */
export function blockKeyboardControl(event: KeyboardEvent, platform: string): void {
  if (event.isComposing || event.keyCode === 229) return
  if (!event.defaultPrevented) {
    if (event.key !== 'Tab' && shouldIgnoreShortcut(event.target)) return
    const accelerator = acceleratorFromEvent(event, platform)
    if (accelerator && isSystemReservedAccelerator(accelerator, platform)) return
    event.preventDefault()
  }
  event.stopPropagation()
}
