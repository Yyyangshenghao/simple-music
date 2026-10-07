import { create } from 'zustand'
import type { GameModeState } from '../types/ipc'
import { useToastStore } from './toast'

interface GameModeStore extends GameModeState {
  sequence: number
  setState(state: GameModeState): void
  configure(state: Partial<GameModeState>): Promise<void>
}

export const useGameModeStore = create<GameModeStore>((set, get) => ({
  enabled: false,
  sequence: 0,
  // React 可能合并连续进/退，序号保证原生窗口仍收到最终恢复配置。
  setState(state) { set(current => ({ ...state, sequence: current.sequence + 1 })) },
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
