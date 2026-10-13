import { useGameModeStore } from '../stores/game-mode'

let stopGameModeSync: (() => void) | undefined

export function initGameModeSync(onInitialState?: () => void): () => void {
  if (stopGameModeSync) return stopGameModeSync
  const desktop = window.desktop
  if (!desktop?.onGameModeChange || !desktop.getGameMode) return () => {}
  let changed = false
  let disposed = false
  const unsubscribe = desktop.onGameModeChange(state => {
    if (disposed) return
    changed = true
    useGameModeStore.getState().setState(state)
  })
  void desktop.getGameMode().then(state => {
    if (disposed || changed) return
    useGameModeStore.getState().setState(state)
    onInitialState?.()
  }).catch(() => {})
  stopGameModeSync = () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    stopGameModeSync = undefined
  }
  return stopGameModeSync
}
