import { create } from 'zustand'
import type { GameModeState } from '../types/ipc'
import { useToastStore } from './toast'

interface GameModeStore extends GameModeState {
  initialized: boolean
  sequence: number
  setState(state: GameModeState): void
  configure(state: Partial<GameModeState>): Promise<void>
}

export const useGameModeStore = create<GameModeStore>((set, get) => ({
  enabled: false,
  initialized: false,
  sequence: 0,
  // 每次主进程确认都递增，确保原生悬浮窗配置可完整重放。
  setState(state) { set(current => ({ ...state, initialized: true, sequence: current.sequence + 1 })) },
  async configure(patch) {
    const desktop = window.desktop
    if (!desktop?.setGameMode) return
    try {
      // 状态由主进程广播，避免较早请求的 Promise 覆盖后续托盘操作。
      await desktop.setGameMode({ enabled: get().enabled, ...patch })
    } catch {
      useToastStore.getState().show('游戏模式切换失败，请重试')
    }
  }
}))
