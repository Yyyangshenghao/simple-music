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
