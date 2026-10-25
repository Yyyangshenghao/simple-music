import { create } from 'zustand'

/** 只属于主窗口的选择面板，不同步到播放宿主。 */
export const useLyricsSourceDialogStore = create<{
  open: boolean
  show(): void
  close(): void
}>((set) => ({ open: false, show: () => set({ open: true }), close: () => set({ open: false }) }))
