import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settings'
import { useShortcutStore } from '../stores/shortcuts'
import { useShuangeStore } from '../stores/shuange'
import { acceleratorFromEvent, isShortcutAction, isSettingsMenuAccelerator, isSystemReservedAccelerator, normalizeAccelerator, shouldIgnoreShortcut } from '../lib/shortcuts'
import { runShortcutAction } from '../lib/shortcut-actions'

/** 启动、设置变更及按键录入时同步注册；响应只接受最新配置。 */
export function useShortcuts(): void {
  useEffect(() => {
    const desktop = window.desktop
    const platform = desktop?.platform ?? 'win32'
    let session = 0
    let disposed = false
    const sync = () => {
      const currentSession = ++session
      const settings = useSettingsStore.getState()
      const { recording } = useShortcutStore.getState()
      const bindings = settings.globalHotkeysEnabled && !recording ? settings.hotkeys : []
      useShortcutStore.setState({ pending: true, results: [], error: '' })
      if (!desktop?.configureHotkeys) {
        useShortcutStore.setState({ pending: false, error: '全局快捷键仅在桌面应用中可用' })
        return
      }
      const settingsAccelerator = settings.localHotkeys.find((item) => item.action === 'settings')?.accelerator ?? ''
      void desktop.configureHotkeys(bindings, recording, settingsAccelerator).then((result) => {
        if (disposed || currentSession !== session) return
        useShortcutStore.setState({ pending: false, results: result.results, menuAccelerators: result.menuAccelerators ?? [], error: result.ok ? '' : '全局快捷键注册失败，请重试' })
      }).catch(() => {
        if (!disposed && currentSession === session) {
          useShortcutStore.setState({ pending: false, error: '全局快捷键注册失败，请重试' })
        }
      })
    }
    const offSettings = useSettingsStore.subscribe((state, previous) => {
      if (state.hotkeys !== previous.hotkeys || state.globalHotkeysEnabled !== previous.globalHotkeysEnabled
        || state.localHotkeys !== previous.localHotkeys) sync()
    })
    const offRecording = useShortcutStore.subscribe((state, previous) => {
      if (state.recording !== previous.recording) sync()
    })
    const offHotkey = desktop?.onHotkey(({ action, source }) => {
      if (useShortcutStore.getState().recording || (source !== 'menu' && !useSettingsStore.getState().globalHotkeysEnabled)) return
      if (action !== 'settings' && document.hasFocus() && shouldIgnoreShortcut(document.activeElement)) return
      if (isShortcutAction(action)) runShortcutAction(action)
    })
    const onKeyDown = (event: KeyboardEvent, captured = false) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229
        || useShortcutStore.getState().recording) return
      // Enter 等按键保留控件原生操作；空格优先走播放快捷键。
      if (!captured && event.key !== ' ' && event.code !== 'Space' && !event.metaKey && !event.ctrlKey && !event.altKey
        && (event.target as Element | null)?.closest?.('button, summary, [role="switch"], [role="slider"]')) return
      const accelerator = acceleratorFromEvent(event, platform)
      if (!accelerator || isSystemReservedAccelerator(accelerator, platform)) return
      const settings = useSettingsStore.getState()
      const runtime = useShortcutStore.getState()
      const binding = settings.localHotkeys.find((item) => normalizeAccelerator(item.accelerator, platform) === accelerator)
      if ((binding?.action !== 'settings' || !isSettingsMenuAccelerator(accelerator)) && shouldIgnoreShortcut(event.target)) return
      const registered = settings.globalHotkeysEnabled && (runtime.pending
        ? settings.hotkeys.some((item) => normalizeAccelerator(item.accelerator, platform) === accelerator)
        : runtime.results.some((item) => item.ok && normalizeAccelerator(item.accelerator, platform) === accelerator))
      // 已成功注册的全局键由主进程分发，避免焦点在主窗口时重复执行。
      if (registered) {
        event.preventDefault()
        return
      }
      if (!binding || !isShortcutAction(binding.action)) return
      // 菜单需要继续接收事件，preventDefault 会取消原生菜单快捷键。
      if (!captured && runtime.menuAccelerators.includes(accelerator)) return
      event.preventDefault()
      if (!event.repeat) runShortcutAction(binding.action)
    }
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229
        || useShortcutStore.getState().recording) return
      const tab = event.key === 'Tab'
      if (!tab && shouldIgnoreShortcut(event.target)) return
      const space = event.key === ' ' || event.code === 'Space'
      const arrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      if (!tab && !space && !arrow) return
      // 用户绑定优先执行，再取消控件的默认导航与激活；菜单同键也由本次事件执行一次。
      onKeyDown(event, true)
      // 系统组合及未配置的修饰键操作继续交给系统或原控件。
      if ((event.metaKey || event.ctrlKey || event.altKey) && !event.defaultPrevented) return
      // 爽歌页面在捕获阶段处理上下切换，避免先触发聚焦控件的导航。
      if (!event.defaultPrevented && arrow && !event.shiftKey && useShuangeStore.getState().active
        && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) return
      if (!event.defaultPrevented) event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDownCapture, true)
    window.addEventListener('keydown', onKeyDown)
    sync()
    return () => {
      disposed = true
      ++session
      offSettings()
      offRecording()
      offHotkey?.()
      window.removeEventListener('keydown', onKeyDownCapture, true)
      window.removeEventListener('keydown', onKeyDown)
      void desktop?.configureHotkeys([]).catch(() => {})
    }
  }, [])
}
