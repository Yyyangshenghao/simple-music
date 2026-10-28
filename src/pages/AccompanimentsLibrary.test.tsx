import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { AccompanimentsLibrary } from './AccompanimentsLibrary'
import { useKaraokeStore } from '../stores/karaoke'

const search = vi.hoisted(() => ({ value: '' }))
vi.mock('react', async original => {
  const react = await original<typeof import('react')>()
  return { ...react, useState: (initial: unknown) => react.useState(initial === '' ? search.value : initial) }
})
vi.mock('../stores/karaoke', async original => {
  const module = await original<typeof import('../stores/karaoke')>()
  const store = module.useKaraokeStore
  return { ...module, useKaraokeStore: Object.assign(() => store.getState(), store) }
})
afterEach(() => { search.value = ''; useKaraokeStore.setState({ jobs: [], items: [], error: '' }) })
it('伴奏页面只管理成品，有生成任务时也不出现队列内容，保留专门队列入口', () => {
  useKaraokeStore.setState({ loaded: true, error: '', jobs: [{ id: 'generating', model: 'hq3', phase: 'separating', progress: .42, directory: '/songs', track: { id: 1, source: 'netease', provider: 'netease', type: 'song', name: '排队中的歌曲', artist: '艺人', artists: [] } }], items: [] })
  const html = renderToStaticMarkup(<AccompanimentsLibrary />)
  expect(html).toContain('任务队列')
  expect(html).toContain('aria-label="搜索伴奏"')
  expect(html).not.toContain('排队中的歌曲')
  expect(html).not.toContain('42%')
  expect(html).not.toContain('首正在生成')
  expect(html).not.toContain('取消')
})

it('低频操作只显示图标，仍有明确名称；丢失的文件保留重新生成入口', () => {
  useKaraokeStore.setState({ loaded: true, error: '', directory: '/music/stems', items: [{
    id: 'missing', key: 'netease:1', model: 'hq3', directory: '/music/stems', fileName: 'song.wav', bytes: 0, generatedAt: 1, available: false,
    track: { id: 1, source: 'netease', provider: 'netease', type: 'song', name: '歌曲', artist: '艺人', artists: [] },
  }] })
  const html = renderToStaticMarkup(<AccompanimentsLibrary />)
  expect(html).toContain('aria-label="伴奏设置"')
  expect(html).toContain('aria-label="任务队列"')
  expect(html).toContain('aria-label="打开伴奏文件夹"')
  expect(html).not.toContain('aria-label="打开文件夹：歌曲"')
  expect(html.indexOf('aria-label="打开伴奏文件夹"')).toBeLessThan(html.indexOf('aria-label="伴奏设置"'))
  expect(html).toContain('aria-label="删除伴奏：歌曲（hq3）"')
  expect(html).toContain('原曲与其他版本保留')
  expect(html).toContain('文件已丢失')
  expect(html).toContain('重新生成')
  expect(html).not.toContain('>保存位置与模型<')
  expect(html).not.toContain('>打开文件夹<')
})

it('伴奏读取失败时显示恢复入口，不能误导用户为尚未生成', () => {
  useKaraokeStore.setState({ loaded: true, error: '伴奏目录无法访问', items: [] })
  const html = renderToStaticMarkup(<AccompanimentsLibrary />)
  expect(html).toContain('伴奏目录无法访问')
  expect(html).toContain('重新读取')
  expect(html).not.toContain('还没有生成伴奏')
  expect(html).not.toContain('没有匹配的伴奏')
})

it('搜索统计显示匹配曲目数，读取失败仍保留已有成品', () => {
  search.value = '回声'
  useKaraokeStore.setState({ loaded: true, error: '刷新失败', items: ['回声', '日落'].map((name, id) => ({
    id: String(id), key: `netease:${id}`, model: 'hq3', directory: '/stems', fileName: `${id}.wav`, bytes: 1, generatedAt: 1, available: true,
    track: { id, source: 'netease', provider: 'netease', type: 'song', name, artist: '艺人', artists: [] },
  })) })
  const html = renderToStaticMarkup(<AccompanimentsLibrary />)
  expect(html).toContain('1 / 2 首')
  expect(html).toContain('播放伴奏：回声')
  expect(html).not.toContain('播放伴奏：日落')
  expect(html).toContain('重新读取')
})
