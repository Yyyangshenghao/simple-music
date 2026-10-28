import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTaskCenter, EMPTY_TASK_SUMMARY, TASK_RESULT_DWELL_MS, type TaskCenterSummary } from './task-center'

const summary = (patch: Partial<TaskCenterSummary> = {}): TaskCenterSummary => ({ ...EMPTY_TASK_SUMMARY, ...patch })
let center: ReturnType<typeof createTaskCenter>
beforeEach(() => { vi.useFakeTimers({ now: 1000 }); center = createTaskCenter() })
afterEach(() => { center.getState().dispose(); vi.useRealTimers() })

describe('任务入口与结果驻留', () => {
  it('无任务隐藏，入队只浮现不弹面板，连续加入触发计数反馈', () => {
    expect(center.getState()).toMatchObject({ visible: false, open: false })
    center.getState().update(summary({ download: 1 }), true)
    center.getState().update(summary({ download: 2, karaoke: 1 }), true)
    expect(center.getState()).toMatchObject({ visible: true, open: false, pulse: 2 })
  })
  it('未查看的完成结果 90 秒后融合，历史记录更新不能重新浮现', () => {
    center.getState().update(summary({ download: 1 }), true)
    center.getState().update(summary({ results: ['d:1'] }), false)
    expect(center.getState()).toMatchObject({ visible: true, completion: 1 })
    vi.advanceTimersByTime(TASK_RESULT_DWELL_MS - 1)
    expect(center.getState().visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(center.getState().visible).toBe(false)
    center.getState().update(summary({ results: ['d:1'] }), false)
    expect(center.getState().visible).toBe(false)
    expect(center.getState().summary.results).toEqual(['d:1'])
  })
  it('面板打开时完成或完成后查看，关闭即融合；面板打开不被计时器关闭', () => {
    center.getState().update(summary({ karaoke: 1, latest: 'karaoke' }), true)
    center.getState().show()
    expect(center.getState().tab).toBe('karaoke')
    center.getState().update(summary({ results: ['k:1'], latest: 'karaoke' }), false)
    vi.advanceTimersByTime(TASK_RESULT_DWELL_MS)
    expect(center.getState()).toMatchObject({ open: true, visible: true })
    center.getState().close()
    expect(center.getState()).toMatchObject({ open: false, visible: false })
  })
  it('有失败、恢复错误或未完成任务时不会融合，清除最后失败项才收起', () => {
    center.getState().update(summary({ failed: 1 }), true)
    center.getState().show()
    center.getState().close()
    vi.advanceTimersByTime(TASK_RESULT_DWELL_MS * 2)
    expect(center.getState().visible).toBe(true)
    center.getState().update(summary({ issue: true }), false)
    expect(center.getState().visible).toBe(true)
    center.getState().update(summary(), false)
    expect(center.getState().visible).toBe(false)
  })
  it('完成结果被失败项阻挡后，移除最后失败项重新开始驻留计时', () => {
    center.getState().update(summary({ failed: 1, results: ['d:1'] }), false)
    vi.advanceTimersByTime(TASK_RESULT_DWELL_MS * 2)
    center.getState().update(summary({ results: ['d:1'] }), false)
    expect(center.getState().visible).toBe(true)
    vi.advanceTimersByTime(TASK_RESULT_DWELL_MS)
    expect(center.getState().visible).toBe(false)
  })
  it('打开另一分区不把未展示的结果标记已读，切到结果分区后关闭才融合', () => {
    center.getState().update(summary({ results: ['k:1'], latest: 'karaoke' }), false)
    center.getState().show('download')
    center.getState().close()
    expect(center.getState().visible).toBe(true)
    center.getState().show('download')
    center.getState().select('karaoke')
    center.getState().close()
    expect(center.getState().visible).toBe(false)
  })
  it('新任务打断融合计时，恢复的暂停队列也只浮现入口', () => {
    center.getState().update(summary({ results: ['d:1'] }), false)
    vi.advanceTimersByTime(80_000)
    center.getState().update(summary({ results: ['d:1'], karaoke: 1, allPaused: true }), true)
    vi.advanceTimersByTime(20_000)
    expect(center.getState()).toMatchObject({ visible: true, open: false })
  })
  it('空队列可以从设置和库主动打开指定分区，关闭立即融合', () => {
    center.getState().show('karaoke')
    expect(center.getState()).toMatchObject({ visible: true, open: true, forcedOpen: true, tab: 'karaoke' })
    center.getState().close()
    expect(center.getState()).toMatchObject({ visible: false, open: false, forcedOpen: false })
  })
})

it('从歌曲打开时传递定位请求，重复打开同一任务可重新定位，切换分区清除请求', () => {
  center.getState().show('karaoke', 'k:job')
  const first = center.getState().focusRequest
  expect(first).toEqual({ id: 'k:job' })
  center.getState().show('karaoke', 'k:job')
  expect(center.getState().focusRequest).not.toBe(first)
  center.getState().select('download')
  expect(center.getState().focusRequest).toBeNull()
})

it('上一批完成记录保留时，取消新任务不应再报成功或重新驻留', () => {
  center.getState().update(summary({ results: ['d:old'] }), false)
  center.getState().show('download')
  center.getState().close()
  const completion = center.getState().completion
  center.getState().update(summary({ download: 1, results: ['d:old'] }), true)
  expect(center.getState().batchResults).toEqual([])
  center.getState().update(summary({ results: ['d:old'] }), false)
  expect(center.getState()).toMatchObject({ visible: false, completion, batchResults: [] })
})

it('旧未读结果不能在取消本批后，通过打开另一空分区重新唤起入口', () => {
  center.getState().update(summary({ results: ['d:old'] }), false)
  center.getState().update(summary({ karaoke: 1, results: ['d:old'] }), true)
  center.getState().update(summary({ results: ['d:old'] }), false)
  center.getState().show('karaoke')
  center.getState().close()
  expect(center.getState()).toMatchObject({ open: false, visible: false, batchResults: [] })
  expect(vi.getTimerCount()).toBe(0)
})
