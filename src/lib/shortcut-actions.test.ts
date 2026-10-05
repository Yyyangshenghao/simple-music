import { afterEach, expect, it } from 'vitest'
import { useNavigationStore } from '../stores/navigation'
import { useVisualStore } from '../stores/visual'
import { useGameModeStore } from '../stores/game-mode'
import { runShortcutAction } from './shortcut-actions'

const initial = useNavigationStore.getState()
const initialVisual = useVisualStore.getState()
const initialGame = useGameModeStore.getState()
afterEach(() => {
  useNavigationStore.setState(initial, true)
  useVisualStore.setState(initialVisual, true)
  useGameModeStore.setState(initialGame, true)
})

it('设置动作打开设置，重复触发不新增导航历史', () => {
  runShortcutAction('settings')
  expect(useNavigationStore.getState().currentView).toBe('settings')
  const history = useNavigationStore.getState().history
  runShortcutAction('settings')
  expect(useNavigationStore.getState().history).toBe(history)
})

it('游戏模式中歌词快捷键仍切换原开关，保持游戏模式', () => {
  useGameModeStore.setState({ enabled: true })
  useVisualStore.setState(state => ({ fx: { ...state.fx, desktopLyrics: false } }))
  runShortcutAction('desktop-lyrics')
  expect(useVisualStore.getState().fx.desktopLyrics).toBe(true)
  expect(useGameModeStore.getState().enabled).toBe(true)
  runShortcutAction('desktop-lyrics')
  expect(useVisualStore.getState().fx.desktopLyrics).toBe(false)
  expect(useGameModeStore.getState().enabled).toBe(true)
})
