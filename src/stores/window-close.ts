import { create } from 'zustand'
import type { WindowCloseBehavior, WindowCloseChoice, WindowCloseState } from '../types/ipc'

interface WindowCloseStore extends WindowCloseState {
  initialized: boolean
  pending: boolean
  error: string
  refresh(): Promise<void>
  configure(behavior: WindowCloseBehavior): Promise<void>
  resolve(action: WindowCloseChoice['action'], remember: boolean): Promise<void>
}

// 广播优先于任何较早的读取或操作回复，状态只由主进程持久化。
let revision = 0

export const useWindowCloseStore = create<WindowCloseStore>((set, get) => ({
  behavior: 'ask',
  promptId: null,
  initialized: false,
  pending: false,
  error: '',
  async refresh() {
    if (get().pending || !window.desktop?.getWindowCloseState) return
    const started = revision
    set({ pending: true, error: '' })
    try {
      const state = await window.desktop.getWindowCloseState()
      if (started === revision) { ++revision; set({ ...state, initialized: true }) }
    } catch {
      if (started === revision) set({ error: '无法读取关闭方式，请重试。' })
    } finally {
      set({ pending: false })
    }
  },
  async configure(behavior) {
    if (get().pending || !window.desktop?.setWindowCloseBehavior) return
    const started = revision
    set({ pending: true, error: '' })
    try {
      const state = await window.desktop.setWindowCloseBehavior(behavior)
      if (started === revision) { ++revision; set({ ...state, initialized: true }) }
    } catch {
      if (started === revision) set({ error: '关闭方式设置失败，请重试。' })
    } finally {
      set({ pending: false })
    }
  },
  async resolve(action, remember) {
    const { promptId, pending } = get()
    if (promptId === null || pending || !window.desktop?.resolveWindowClose) return
    const started = revision
    set({ pending: true, error: '' })
    try {
      const state = await window.desktop.resolveWindowClose({ promptId, action, remember: action !== 'cancel' && remember })
      if (started === revision) { ++revision; set({ ...state, initialized: true }) }
    } catch {
      if (started === revision) set({ error: '操作未完成，请重试。' })
    } finally {
      set({ pending: false })
    }
  },
}))

export function initWindowCloseSync(): () => void {
  const desktop = window.desktop
  if (desktop?.platform !== 'win32' || !desktop.onWindowCloseState || !desktop.getWindowCloseState) return () => {}
  let disposed = false
  const off = desktop.onWindowCloseState((state) => {
    if (disposed) return
    ++revision
    useWindowCloseStore.setState({ ...state, initialized: true, error: '' })
  })
  const started = revision
  void desktop.getWindowCloseState().then((state) => {
    if (!disposed && started === revision) {
      ++revision
      useWindowCloseStore.setState({ ...state, initialized: true, error: '' })
    }
  }).catch(() => {
    if (!disposed && started === revision) useWindowCloseStore.setState({ error: '无法读取关闭方式，请重试。' })
  })
  return () => { disposed = true; off() }
}
