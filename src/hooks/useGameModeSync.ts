import { useEffect } from 'react'
import { useGameModeStore } from '../stores/game-mode'

export function useGameModeSync(): void {
  useEffect(() => {
    const desktop = window.desktop
    if (!desktop?.onGameModeChange || !desktop.getGameMode) return
    let changed = false
    let disposed = false
    const unsubscribe = desktop.onGameModeChange(state => {
      changed = true
      useGameModeStore.getState().setState(state)
    })
    void desktop.getGameMode().then(state => {
      if (!disposed && !changed) useGameModeStore.getState().setState(state)
    }).catch(() => {})
    return () => { disposed = true; unsubscribe() }
  }, [])
}
