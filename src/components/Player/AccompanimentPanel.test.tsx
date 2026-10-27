import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { AccompanimentPanel } from './AccompanimentPanel'
import type { Track } from '../../types/domain'
import type { Accompaniment, KaraokeModelId, KaraokeModelView } from '../../types/karaoke'
import type { KaraokeJob } from '../../lib/karaoke/queue'

const h = vi.hoisted(() => ({
  accompaniment: null as Track | null, select: vi.fn(), close: vi.fn(), show: vi.fn(), setModel: vi.fn(), model: 'kara2' as KaraokeModelId,
  queue: { items: [] as Accompaniment[], jobs: [] as KaraokeJob[], loaded: true, error: '', paused: false, load: vi.fn(), enqueue: vi.fn(), retry: vi.fn(), cancel: vi.fn() },
  models: { models: [] as KaraokeModelView[], f16: true as boolean | null, loaded: true, error: null as string | null, load: vi.fn() },
}))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: () => [false, vi.fn()], useEffect: () => {} }))
vi.mock('../../stores/player', () => ({ usePlayerStore: (select: (state: unknown) => unknown) => select({ accompaniment: h.accompaniment, selectAccompaniment: h.select }) }))
vi.mock('../../stores/karaoke', () => ({ useKaraokeStore: () => h.queue }))
vi.mock('../../stores/karaoke-models', () => ({ useKaraokeModelsStore: () => h.models }))
vi.mock('../../stores/settings', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select({ karaokeModel: h.model, setKaraokeModel: h.setModel, performance: { pageTransitionMotion: false } }) }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.show }) } }))

type Element = ReactElement<{ children?: ReactNode; 'aria-label'?: string; 'aria-pressed'?: boolean; 'data-primary'?: boolean; disabled?: boolean; onClick?: () => void; onChange?: (event: unknown) => void }>
function nodes(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child) ? [child as Element, ...nodes(child.props.children)] : [])
}
function content(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? content(child.props.children) : String(child)).join('')
}
const original: Track = { id: 1, source: 'netease', provider: 'netease', type: 'song', name: '歌曲', artist: '艺人', artists: [] }
const item = (id: string, model: KaraokeModelId, available = true): Accompaniment => ({ id: id.repeat(40), key: 'netease:1', track: original, model, available, directory: '/songs', fileName: 'song.wav', bytes: 44, generatedAt: 1 })
const render = (track = original) => AccompanimentPanel({ track, onClose: h.close })
const button = (name: string, track = original) => nodes(render(track)).find(node => node.type === 'button' && (node.props['aria-label'] === name || content(node.props.children) === name))!
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
beforeEach(() => {
  vi.clearAllMocks()
  h.select.mockReset().mockResolvedValue(undefined)
  h.queue.enqueue.mockReset().mockResolvedValue(undefined)
  h.queue.items = [item('a', 'hq3'), item('b', 'hq3-fp16'), item('c', 'kara2', false)]
  h.queue.jobs = []; h.queue.loaded = true; h.queue.error = ''; h.queue.paused = false
  h.accompaniment = null; h.model = 'kara2'; h.models.f16 = true; h.models.error = null
  h.models.models = (['hq3', 'hq3-fp16', 'kara2'] as const).map(id => ({ id, name: id, state: 'ready', requiresF16: id === 'hq3-fp16' } as KaraokeModelView))
})

it('显示原曲、多个已生成版本与丢失版本，并标出当前选择', () => {
  h.accompaniment = { ...original, source: 'local', id: `karaoke:${'b'.repeat(40)}` }
  expect(button('原曲').props['aria-pressed']).toBe(false)
  expect(button('使用伴奏：hq3').props.disabled).toBe(false)
  expect(button('使用伴奏：hq3-fp16').props['aria-pressed']).toBe(true)
  expect(button('使用伴奏：kara2').props.disabled).toBe(true)
  // 版本以模型区分，不显示生成时间
  expect(content(button('使用伴奏：hq3').props.children)).toContain('HQ3 标准')
  expect(content(button('使用伴奏：hq3').props.children)).not.toMatch(/\d+\/\d+/)
  h.queue.items = []
  expect(content(render())).toContain('去除人声，生成伴奏')
  expect(button('生成伴奏').props).toMatchObject({ disabled: false, 'data-primary': true })
  h.queue.items = [item('a', 'hq3')]
  expect(button('生成伴奏').props['data-primary']).toBe(false)
})

it('选择精确版本和原曲时只发送版本 ID 与歌曲身份，不传入事件', async () => {
  button('使用伴奏：hq3-fp16').props.onClick!()
  expect(h.select).toHaveBeenCalledWith('b'.repeat(40), 'netease:1')
  button('原曲').props.onClick!()
  expect(h.select).toHaveBeenLastCalledWith(null, 'netease:1')
  await flush()
})

it('选择版本后面板保持打开，失败时提示', async () => {
  button('原曲').props.onClick!()
  await flush()
  expect(h.close).not.toHaveBeenCalled()
  h.select.mockRejectedValueOnce(new Error('切换失败'))
  button('使用伴奏：hq3').props.onClick!()
  await flush()
  expect(h.close).not.toHaveBeenCalled()
  expect(h.show).toHaveBeenCalledWith('切换失败')
})

it('从伴奏进入时用原曲生成所选新版本，不改变播放或关闭面板', async () => {
  const stem = { ...original, source: 'local' as const, provider: 'local' as const, id: `karaoke:${'a'.repeat(40)}`, accompanimentOriginal: original }
  button('生成伴奏', stem).props.onClick!()
  await flush()
  expect(h.queue.enqueue).toHaveBeenCalledWith(original, 'kara2')
  expect(h.select).not.toHaveBeenCalled()
  expect(h.close).not.toHaveBeenCalled()
  expect(h.show).not.toHaveBeenCalled()
})

const progress = (track = original) => nodes(render(track)).find(node => node.props['aria-label'] === '伴奏生成进度')

it('已有成品禁止重复生成，进行中显示进度而非按钮，失败任务允许重试', async () => {
  h.model = 'hq3'
  expect(button('此版本已生成').props.disabled).toBe(true)
  h.model = 'kara2'
  h.queue.jobs = [{ id: 'job', model: 'kara2', track: original, phase: 'queued', progress: 0, directory: '/songs' }]
  expect(content(progress()!.props.children)).toContain('等待生成')
  expect(button('生成伴奏')).toBeUndefined()
  h.queue.jobs[0].phase = 'separating'; h.queue.jobs[0].progress = 0.37
  expect(content(progress()!.props.children)).toContain('37%')
  h.queue.jobs[0].phase = 'failed'
  button('重试生成').props.onClick!(); await flush()
  expect(h.queue.retry).toHaveBeenCalledWith('job')
  expect(h.queue.enqueue).not.toHaveBeenCalled()
})

it('QQ 补全 mid 后仍识别补全前已排队的任务', () => {
  const track: Track = { ...original, source: 'qq', provider: 'qq' }
  h.queue.jobs = [{ id: 'job', model: 'kara2', track, phase: 'queued', progress: 0, directory: '/songs' }]
  expect(progress({ ...track, mid: 'same-song' })).toBeDefined()
})

it('库读取失败和显卡不支持时禁止生成，生成请求失败给出错误', async () => {
  h.queue.error = '读取失败'
  expect(button('生成伴奏').props.disabled).toBe(true)
  h.queue.error = ''; h.model = 'hq3-fp16'; h.models.f16 = false; h.queue.items = []
  expect(button('生成伴奏').props.disabled).toBe(true)
  h.model = 'kara2'; h.queue.enqueue.mockRejectedValue(new Error('目录不可写'))
  button('生成伴奏').props.onClick!(); await flush()
  expect(h.show).toHaveBeenCalledWith('目录不可写')
})

it('进行中的任务可取消，保存阶段不显示取消', () => {
  h.queue.jobs = [{ id: 'job', model: 'kara2', track: original, phase: 'separating', progress: 0.5, directory: '/songs' }]
  button('取消').props.onClick!()
  expect(h.queue.cancel).toHaveBeenCalledWith('job')
  h.queue.jobs[0].phase = 'saving'
  expect(button('取消')).toBeUndefined()
})
