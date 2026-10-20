import { create } from 'zustand'

const AUTO_DISMISS_MS = 3200

interface ToastStore {
  message: string | null
  show(message: string): void
  dismiss(): void
}

let timer: ReturnType<typeof setTimeout> | null = null

/** 全局轻提示,同一时刻只显示一条,后来者覆盖并重置计时。 */
export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  show(message) {
    if (timer) clearTimeout(timer)
    set({ message })
    timer = setTimeout(() => set({ message: null }), AUTO_DISMISS_MS)
  },
  dismiss() {
    if (timer) clearTimeout(timer)
    set({ message: null })
  }
}))

interface ActionToast {
  message: string
  label: string
  run(): void
}

interface ActionToastStore {
  notification: ActionToast | null
  show(message: string, label: string, run: () => void): void
  activate(): void
  dismiss(): void
}

let actionTimer: ReturnType<typeof setTimeout> | null = null

/** 撤销回调只留在主界面，不进入播放宿主的提示同步与 IPC。 */
export const useActionToastStore = create<ActionToastStore>((set, get) => ({
  notification: null,
  show(message, label, run) {
    if (actionTimer) clearTimeout(actionTimer)
    set({ notification: { message, label, run } })
    actionTimer = setTimeout(() => get().dismiss(), 6000)
  },
  activate() {
    const notification = get().notification
    if (!notification) return
    try {
      notification.run()
      get().dismiss()
    } catch (failure) {
      get().show(failure instanceof Error ? failure.message : '撤销失败，请重试', notification.label, notification.run)
    }
  },
  dismiss() {
    if (actionTimer) clearTimeout(actionTimer)
    actionTimer = null
    set({ notification: null })
  },
}))
