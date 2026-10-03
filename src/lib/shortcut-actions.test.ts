import { afterEach, expect, it } from 'vitest'
import { useNavigationStore } from '../stores/navigation'
import { runShortcutAction } from './shortcut-actions'

const initial = useNavigationStore.getState()
afterEach(() => useNavigationStore.setState(initial, true))

it('设置动作打开设置，重复触发不新增导航历史', () => {
  runShortcutAction('settings')
  expect(useNavigationStore.getState().currentView).toBe('settings')
  const history = useNavigationStore.getState().history
  runShortcutAction('settings')
  expect(useNavigationStore.getState().history).toBe(history)
})
