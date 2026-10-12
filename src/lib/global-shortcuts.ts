import { useSettingsStore } from '../stores/settings'
import { useShortcutStore } from '../stores/shortcuts'
import { isShortcutAction, shouldIgnoreShortcut } from './shortcuts'
import { runShortcutAction } from './shortcut-actions'

let stopGlobalShortcuts: (() => void) | undefined

/** 宿主持有全局注册与原生菜单命令，界面挂载/卸载不重新配置。 */
export function initGlobalShortcuts(): () => void {
  if (stopGlobalShortcuts) return stopGlobalShortcuts
  const desktop = window.desktop
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
    if (disposed || document.querySelector?.('dialog[open]')) return
    if (useShortcutStore.getState().recording || (source !== 'menu' && !useSettingsStore.getState().globalHotkeysEnabled)) return
    if (action !== 'settings' && document.hasFocus() && shouldIgnoreShortcut(document.activeElement)) return
    if (isShortcutAction(action)) runShortcutAction(action)
  })
  sync()
  stopGlobalShortcuts = () => {
    if (disposed) return
    disposed = true
    ++session
    offSettings()
    offRecording()
    offHotkey?.()
    void desktop?.configureHotkeys([]).catch(() => {})
    stopGlobalShortcuts = undefined
  }
  return stopGlobalShortcuts
}
