import { afterEach, expect, it, vi } from 'vitest'
import { useNavigationStore } from '../stores/navigation'
import { useVisualStore } from '../stores/visual'
import { useGameModeStore } from '../stores/game-mode'
import { runShortcutAction } from './shortcut-actions'
import { usePlaylistStore } from '../stores/playlist'
import { useShuangeStore } from '../stores/shuange'

const initial = useNavigationStore.getState()
const initialVisual = useVisualStore.getState()
const initialGame = useGameModeStore.getState()
const initialShuange = useShuangeStore.getState()
afterEach(() => {
  vi.restoreAllMocks()
  useShuangeStore.setState(initialShuange, true)
  useNavigationStore.setState(initial, true)
  useVisualStore.setState(initialVisual, true)
  useGameModeStore.setState(initialGame, true)
})

it('刷歌期间上下首快捷键只操作刷歌 feed，退出后仍操作普通队列', () => {
  const queueNext = vi.spyOn(usePlaylistStore.getState(), 'next').mockImplementation(() => {})
  const queuePrev = vi.spyOn(usePlaylistStore.getState(), 'prev').mockImplementation(() => {})
  const feedNext = vi.fn().mockResolvedValue(undefined)
  const feedPrev = vi.fn().mockResolvedValue(undefined)
  useShuangeStore.setState({ active: true, next: feedNext, prev: feedPrev })
  runShortcutAction('next')
  runShortcutAction('prev')
  expect(feedNext).toHaveBeenCalledOnce()
  expect(feedPrev).toHaveBeenCalledOnce()
  expect(queueNext).not.toHaveBeenCalled()
  expect(queuePrev).not.toHaveBeenCalled()
  useShuangeStore.setState({ active: false })
  runShortcutAction('next')
  runShortcutAction('prev')
  expect(queueNext).toHaveBeenCalledOnce()
  expect(queuePrev).toHaveBeenCalledOnce()
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
