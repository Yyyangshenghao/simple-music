import { create } from 'zustand'

export type TaskTab = 'download' | 'karaoke'
export interface TaskCenterSummary {
  download: number
  karaoke: number
  failed: number
  running: number
  allPaused: boolean
  progress: number | null
  current: TaskTab
  latest: TaskTab
  currentKey: string
  /** 完成项身份用于区分新结果与历史记录清理。 */
  results: string[]
  issue: boolean
}
export const EMPTY_TASK_SUMMARY: TaskCenterSummary = {
  download: 0, karaoke: 0, failed: 0, running: 0, allPaused: false,
  progress: null, current: 'download', latest: 'download', currentKey: '', results: [], issue: false,
}
export const TASK_RESULT_DWELL_MS = 90_000

/** 面板和结果已读状态只属于主界面，不写入后台快照或存档。 */
export function createTaskCenter() {
  let timer: ReturnType<typeof setTimeout> | undefined
  const inTab = (id: string, tab: TaskTab) => id.startsWith(tab === 'download' ? 'd:' : 'k:')
  return create<{
    open: boolean
    tab: TaskTab
    seenAt: number | null
    seenResults: string[]
    lastSettledAt: number | null
    forcedOpen: boolean
    focusRequest: { id: string } | null
    visible: boolean
    pulse: number
    completion: number
    summary: TaskCenterSummary
    batchResults: string[]
    show(tab?: TaskTab, taskId?: string): void
    close(): void
    select(tab: TaskTab): void
    update(summary: TaskCenterSummary, added: boolean): void
    dispose(): void
  }>((set, get) => ({
    open: false, tab: 'download', seenAt: null, seenResults: [], lastSettledAt: null,
    forcedOpen: false, focusRequest: null, visible: false, pulse: 0, completion: 0, summary: EMPTY_TASK_SUMMARY, batchResults: [],
    show(tab, taskId) {
      const selected = tab ?? get().summary.latest
      set({ open: true, visible: true, forcedOpen: tab !== undefined, tab: selected, focusRequest: taskId ? { id: taskId } : null, seenAt: Date.now(),
        seenResults: [...new Set([...get().seenResults, ...get().summary.results.filter(id => inTab(id, selected))])] })
    },
    close() {
      const { summary } = get()
      const work = summary.download + summary.karaoke + summary.failed > 0 || summary.issue
      const unseen = get().batchResults.some(id => !get().seenResults.includes(id))
      const withinDwell = get().lastSettledAt === null || Date.now() - get().lastSettledAt! < TASK_RESULT_DWELL_MS
      set({ open: false, forcedOpen: false, visible: work || (unseen && withinDwell) })
    },
    select(tab) { set({ tab, focusRequest: null, seenAt: Date.now(), seenResults: [...new Set([...get().seenResults, ...get().summary.results.filter(id => inTab(id, tab))])] }) },
    update(summary, added) {
      const previous = get()
      const work = summary.download + summary.karaoke + summary.failed > 0 || summary.issue
      const addedResults = summary.results.filter(id => !previous.summary.results.includes(id))
      const newResults = addedResults.length > 0
      const previousWork = previous.summary.download + previous.summary.karaoke + previous.summary.failed > 0 || previous.summary.issue
      // 新一批任务不能借用上批的完成记录，把取消或移除误报成成功。
      const batchResults = [...new Set([
        ...(!previousWork && work ? [] : previous.batchResults.filter(id => summary.results.includes(id))),
        ...addedResults,
      ])]
      const settled = !work && (newResults || previousWork)
      const lastSettledAt = settled ? Date.now() : previous.lastSettledAt
      if (work || settled) clearTimeout(timer)
      set({
        summary, lastSettledAt, batchResults,
        visible: work || previous.open || (settled && batchResults.length > 0) || (!added && previous.visible && batchResults.length > 0),
        pulse: previous.pulse + (added ? 1 : 0),
        completion: previous.completion + (settled && newResults ? 1 : 0),
        seenResults: [...new Set([...previous.seenResults.filter(id => summary.results.includes(id)),
          ...summary.results.filter(id => previous.open && inTab(id, previous.tab))])],
        ...(previous.open && newResults ? { seenAt: Date.now() } : {}),
      })
      if (settled && batchResults.length > 0) timer = setTimeout(() => {
        if (!get().open) set({ visible: false })
      }, TASK_RESULT_DWELL_MS)
    },
    dispose() { clearTimeout(timer) },
  }))
}

export const useTaskCenterStore = createTaskCenter()
export const useTaskCenterSummary = () => useTaskCenterStore(state => state.summary)
