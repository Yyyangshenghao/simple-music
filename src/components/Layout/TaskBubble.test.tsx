import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskBubble } from './TaskBubble'
import { EMPTY_TASK_SUMMARY, useTaskCenterStore } from '../../stores/task-center'

vi.mock('../../stores/task-center', async original => {
  const module = await original<typeof import('../../stores/task-center')>()
  const store = module.useTaskCenterStore
  return { ...module, useTaskCenterStore: Object.assign(() => store.getState(), store) }
})
beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  useTaskCenterStore.setState({ open: false, visible: true, summary: EMPTY_TASK_SUMMARY, batchResults: [] })
})
afterEach(() => vi.unstubAllGlobals())
const render = () => renderToStaticMarkup(<TaskBubble><span>账号</span></TaskBubble>)
it('任务完成后显示明确勾选，不保留进度圆环', () => {
  useTaskCenterStore.getState().update({ ...EMPTY_TASK_SUMMARY, results: ['d:1'] }, false)
  const html = render()
  expect(html).toContain('data-state="complete"')
  expect(html).toContain('m5 12 4.5 4.5L19 7')
  expect(html).toContain('任务已完成，查看结果')
  expect(html).not.toContain('data-progress-ring')
})
it.each([
  { download: 1, running: 1, progress: 1 },
  { karaoke: 1, allPaused: true },
  { failed: 1 },
  { issue: true },
])('仍有任务、失败或恢复问题时，历史完成记录不能误报全部完成：%o', state => {
  useTaskCenterStore.setState({ summary: { ...EMPTY_TASK_SUMMARY, results: ['d:old'], ...state } })
  const html = render()
  expect(html).not.toContain('data-state="complete"')
  expect(html).not.toContain('任务已完成，查看结果')
})
it('只有正在运行的任务才显示进度圆环', () => {
  useTaskCenterStore.setState({ summary: { ...EMPTY_TASK_SUMMARY, download: 1, running: 1, progress: .62 } })
  expect(render()).toContain('data-progress-ring')
  useTaskCenterStore.setState({ summary: { ...EMPTY_TASK_SUMMARY, download: 1 } })
  expect(render()).not.toContain('data-progress-ring')
})

it('上批成功后取消本批任务，不用旧记录显示完成勾选', () => {
  const results = ['d:old']
  useTaskCenterStore.getState().update({ ...EMPTY_TASK_SUMMARY, results }, false)
  useTaskCenterStore.getState().update({ ...EMPTY_TASK_SUMMARY, download: 1, results }, true)
  useTaskCenterStore.getState().update({ ...EMPTY_TASK_SUMMARY, results }, false)
  const html = render()
  expect(html).not.toContain('data-state="complete"')
  expect(html).not.toContain('任务已完成，查看结果')
})
