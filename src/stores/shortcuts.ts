import { create } from 'zustand'
import type { HotkeyOutcome } from '../types/ipc'

/** 注册反馈与录入状态仅在本次会话有效，不写入设置存档。 */
export const useShortcutStore = create<{
  recording: boolean
  pending: boolean
  results: HotkeyOutcome[]
  menuAccelerators: string[]
  error: string
  setRecording(recording: boolean): void
}>((set) => ({
  recording: false,
  pending: true,
  results: [],
  menuAccelerators: [],
  error: '',
  setRecording: (recording) => set({ recording })
}))
