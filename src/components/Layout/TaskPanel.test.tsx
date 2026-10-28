import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskPanel } from './TaskPanel'
import { useOfflineCacheStore } from '../../stores/offline-cache'
import { useKaraokeStore } from '../../stores/karaoke'
import { useTaskCenterStore } from '../../stores/task-center'
import type { Track } from '../../types/domain'

vi.mock('../../stores/offline-cache', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/offline-cache')>()
  const store = original.useOfflineCacheStore
  return { ...original, useOfflineCacheStore: Object.assign(
    (selector?: (state: ReturnType<typeof store.getState>) => unknown) => selector ? selector(store.getState()) : store.getState(), store
  ) }
})
vi.mock('../../stores/karaoke', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/karaoke')>()
  const store = original.useKaraokeStore
  return { ...original, useKaraokeStore: Object.assign(
    (selector?: (state: ReturnType<typeof store.getState>) => unknown) => selector ? selector(store.getState()) : store.getState(), store
  ) }
})
vi.mock('../../stores/task-center', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/task-center')>()
  const store = original.useTaskCenterStore
  return { ...original, useTaskCenterStore: Object.assign(
    (selector?: (state: ReturnType<typeof store.getState>) => unknown) => selector ? selector(store.getState()) : store.getState(), store
  ) }
})

const track = (id: number): Track => ({ id, provider: 'netease', source: 'netease', type: 'song', name: `歌曲${id}`, artist: '艺人', artists: [], cover: 'https://p1.music.126.net/cover.jpg' })
beforeEach(() => {
  vi.stubGlobal('window', { desktop: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  useTaskCenterStore.setState({ tab: 'download' })
  useOfflineCacheStore.setState({ jobs: [], paused: false, directoryError: '', recoveryError: '', downloadDir: '/songs' })
  useKaraokeStore.setState({ jobs: [], recent: [], items: [], paused: false, error: '', directoryNotice: '', directory: '/stems' })
})
afterEach(() => vi.unstubAllGlobals())
it('下载按进行中、等待、失败、完成分组，缩图且保留目录影响提示', () => {
  useOfflineCacheStore.setState({ jobs: (['done', 'failed', 'queued', 'saving'] as const).map((status, id) => ({ track: track(id), status, directory: '/songs', controller: new AbortController(), totalBytes: 100, receivedBytes: 42 })) })
  const html = renderToStaticMarkup(<TaskPanel />)
  const positions = ['进行中', '等待', '失败', '已完成'].map(label => html.indexOf(`aria-label="${label}"`))
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
  expect(html).toContain('42%')
  expect(html).toContain('param%3D80y80')
  expect(html).toContain('只影响之后加入的任务，已有文件保留')
  expect(html).toContain('全部重试')
  expect(html).toContain('打开所在文件夹')
})
it('伴奏保存中不提供取消，失败可重试，完成记录提供播放', () => {
  useTaskCenterStore.setState({ tab: 'karaoke' })
  useKaraokeStore.setState({ jobs: [
    { id: 'saving', track: track(1), model: 'hq3', directory: '/songs', phase: 'saving', progress: 0 },
    { id: 'failed', track: track(2), model: 'hq3', directory: '/songs', phase: 'failed', progress: 0, error: '无法生成' },
  ], recent: [{ jobId: 'complete', accompanimentId: 'saved', track: track(3), model: 'hq3', at: 1000 }] })
  const html = renderToStaticMarkup(<TaskPanel />)
  expect(html).not.toContain('取消任务：歌曲1')
  expect(html).toContain('移除记录：歌曲2')
  expect(html).toContain('无法生成')
  expect(html).toContain('aria-label="播放：歌曲3"')
  expect(html).toContain('已加入伴奏库')
})
it('空伴奏分区仍保留两分区入口和生成引导', () => {
  useTaskCenterStore.setState({ tab: 'karaoke' })
  const html = renderToStaticMarkup(<TaskPanel />)
  expect(html).toContain('task-tab-download')
  expect(html).toContain('task-tab-karaoke')
  expect(html).toContain('在播放页的麦克风按钮生成伴奏')
})

it('队列的逐项操作和目录设置使用带名称的图标，批量操作保留文字', () => {
  useOfflineCacheStore.setState({ jobs: [
    { track: track(1), status: 'failed', directory: '/songs', controller: new AbortController(), error: '下载失败' },
    { track: track(2), status: 'done', directory: '/songs', controller: new AbortController() },
  ] })
  const html = renderToStaticMarkup(<TaskPanel />)
  expect(html).toContain('aria-label="重试：歌曲1"')
  expect(html).toContain('aria-label="文件夹：歌曲2"')
  expect(html).toContain('aria-label="更改目录"')
  expect(html).toContain('移除记录，已保存的文件保留')
  expect(html).toContain('全部重试')
  expect(html).not.toContain('>文件夹<')
  expect(html).not.toContain('>更改目录<')
})

it('下载和伴奏分区都提供明确的库导航入口', () => {
  useTaskCenterStore.setState({ tab: 'download' })
  expect(renderToStaticMarkup(<TaskPanel />)).toContain('aria-label="前往离线音乐"')
  useTaskCenterStore.setState({ tab: 'karaoke' })
  expect(renderToStaticMarkup(<TaskPanel />)).toContain('aria-label="前往伴奏库"')
})
