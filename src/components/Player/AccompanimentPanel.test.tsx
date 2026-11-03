import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { AccompanimentPanel } from './AccompanimentPanel'
import type { Track } from '../../types/domain'
import type { Accompaniment, KaraokeModelId, KaraokeModelView } from '../../types/karaoke'
import type { KaraokeJob } from '../../lib/karaoke/queue'

const h = vi.hoisted(() => ({
  adding: false, pending: { current: false },
  accompaniment: null as Track | null, select: vi.fn(), close: vi.fn(), queueShow: vi.fn(), show: vi.fn(), setModel: vi.fn(), model: 'kara2' as KaraokeModelId,
  queue: { items: [] as Accompaniment[], jobs: [] as KaraokeJob[], loaded: true, error: '', paused: false, load: vi.fn(), enqueue: vi.fn(), retry: vi.fn(), cancel: vi.fn() },
  models: { models: [] as KaraokeModelView[], f16: true as boolean | null, loaded: true, error: null as string | null, load: vi.fn() },
}))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: () => [h.adding, (value: boolean) => { h.adding = value }], useRef: () => h.pending, useEffect: () => {} }))
vi.mock('../../stores/player', () => ({ usePlayerStore: (select: (state: unknown) => unknown) => select({ accompaniment: h.accompaniment, selectAccompaniment: h.select }) }))
vi.mock('../../stores/karaoke', () => ({ useKaraokeStore: () => h.queue }))
vi.mock('../../stores/karaoke-models', () => ({ useKaraokeModelsStore: () => h.models }))
vi.mock('../../stores/settings', () => ({ DEFAULT_KARAOKE_LEAD: 0, DEFAULT_KARAOKE_BACKING: 0.5, useSettingsStore: (select: (state: unknown) => unknown) => select({ karaokeModel: h.model, setKaraokeModel: h.setModel, karaokeLead: 0, karaokeBacking: 0.5, setKaraokeVocalMix: vi.fn(), performance: { pageTransitionMotion: false } }) }))
vi.mock('../../stores/task-center', () => ({ useTaskCenterStore: { getState: () => ({ show: h.queueShow }) } }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.show }) } }))

type Element = ReactElement<{ children?: ReactNode; 'aria-label'?: string; 'aria-pressed'?: boolean; 'data-primary'?: boolean; 'aria-busy'?: boolean; disabled?: boolean; onClick?: () => void; onChange?: (event: unknown) => void }>
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
type Choice = { value: KaraokeModelId; state: string; hint: string; description: string; disabled: boolean }
type Chooser = { items: Choice[]; value: KaraokeModelId; busy: boolean; onPick(value: KaraokeModelId): void }
const chooser = (track = original) => nodes(render(track)).find(node => typeof node.type === 'function' && Array.isArray((node.props as { items?: unknown }).items))!.props as unknown as Chooser
const choice = (id: KaraokeModelId, track = original) => chooser(track).items.find(item => item.value === id)!
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
beforeEach(() => {
  vi.clearAllMocks()
  h.adding = false; h.pending.current = false
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
  expect(content(button('使用伴奏：hq3').props.children)).toContain('HQ3')
  expect(content(button('使用伴奏：hq3').props.children)).not.toMatch(/\d+\/\d+/)
  // 模型选择即生成：每个模型带上特点与点击后的动作，已生成的标出
  expect(choice('hq3')).toMatchObject({ state: 'saved', hint: '已生成，点击播放' })
  expect(choice('kara2')).toMatchObject({ state: 'idle', hint: '', disabled: false })
  expect(content(render())).not.toContain('去除人声，生成伴奏')
})

it('有伴奏时一直保留人声调节，原曲或旧版本下禁用并说明原因，切换不改变布局', () => {
  const sliders = () => nodes(render()).filter(node => (node.props as { ariaLabel?: string }).ariaLabel?.endsWith('保留'))
  expect(sliders().map(node => (node.props as { disabled?: boolean }).disabled)).toEqual([true, true])
  expect(content(render())).toContain('播放伴奏时可调')
  h.queue.items = [{ ...item('a', 'hq3'), vocals: true }]
  h.accompaniment = { ...original, source: 'local', id: `karaoke:${'a'.repeat(40)}` }
  expect(sliders().map(node => (node.props as { disabled?: boolean }).disabled)).toEqual([false, false])
  h.queue.items = [item('a', 'hq3')]
  expect(content(render())).toContain('重新生成后可调')
  h.queue.items = []
  expect(sliders()).toHaveLength(0)
})

it('未下载的模型在点击说明里写明首次下载大小', () => {
  h.models.models = h.models.models.map(model => ({ ...model, state: 'missing', bytes: 64 * 1024 * 1024 }))
  expect(choice('kara2').hint).toBe('首次需下载约 64 MB 模型')
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

it('点击未生成的模型直接用原曲生成，并记为默认模型，不改变播放或关闭面板', async () => {
  h.model = 'hq3'
  const stem = { ...original, source: 'local' as const, provider: 'local' as const, id: `karaoke:${'a'.repeat(40)}`, accompanimentOriginal: original }
  chooser(stem).onPick('kara2')
  await flush()
  expect(h.setModel).toHaveBeenCalledWith('kara2')
  expect(h.queue.enqueue).toHaveBeenCalledWith(original, 'kara2')
  expect(h.select).not.toHaveBeenCalled()
  expect(h.close).not.toHaveBeenCalled()
  expect(h.show).not.toHaveBeenCalled()
})

it('点击已生成的模型播放该版本，不重复生成', async () => {
  chooser().onPick('hq3')
  await flush()
  expect(h.select).toHaveBeenCalledWith('a'.repeat(40), 'netease:1')
  expect(h.queue.enqueue).not.toHaveBeenCalled()
})

it('运行和失败任务点击都定位到专门队列，不在版本面板显示进度或重试', () => {
  h.queue.jobs = [{ id: 'job', model: 'kara2', track: original, phase: 'queued', progress: 0, directory: '/songs' }]
  for (const phase of ['queued', 'separating', 'saving', 'failed'] as const) {
    h.queue.jobs[0].phase = phase
    expect(nodes(render()).find(node => node.props['aria-label'] === '伴奏生成进度')).toBeUndefined()
    expect(choice('kara2')).toMatchObject({ state: phase === 'failed' ? 'failed' : 'running', disabled: false })
    chooser().onPick('kara2')
    expect(h.queueShow).toHaveBeenLastCalledWith('karaoke', 'k:job')
  }
  expect(h.close).toHaveBeenCalledTimes(4)
  expect(h.queue.retry).not.toHaveBeenCalled()
  expect(h.queue.enqueue).not.toHaveBeenCalled()
})

it('QQ 补全 mid 后仍可查看补全前已排队的任务', () => {
  const track: Track = { ...original, source: 'qq', provider: 'qq' }
  h.queue.jobs = [{ id: 'job', model: 'kara2', track, phase: 'queued', progress: 0, directory: '/songs' }]
  chooser({ ...track, mid: 'same-song' }).onPick('kara2')
  expect(h.queueShow).toHaveBeenCalledWith('karaoke', 'k:job')
})

it('库读取失败和显卡不支持时禁止生成，生成请求失败给出错误', async () => {
  h.queue.items = []
  h.queue.error = '读取失败'
  expect(choice('kara2').disabled).toBe(true)
  h.queue.error = ''; h.models.f16 = false
  expect(choice('hq3-fp16')).toMatchObject({ disabled: true, hint: '当前显卡不支持此模型' })
  h.queue.enqueue.mockRejectedValue(new Error('目录不可写'))
  chooser().onPick('kara2'); await flush()
  expect(h.show).toHaveBeenCalledWith('目录不可写')
})

it('加入回执未返回时模型选择整体忙碌', () => {
  h.adding = true
  expect(chooser().busy).toBe(true)
})

it('快速重复点击只发送一次加入请求，回执后恢复操作', async () => {
  h.queue.items = []
  let resolve!: () => void
  h.queue.enqueue.mockImplementation(() => new Promise<void>(done => { resolve = done }))
  const { onPick } = chooser()
  onPick('kara2')
  onPick('kara2')
  expect(h.queue.enqueue).toHaveBeenCalledOnce()
  resolve()
  await flush()
  expect(h.adding).toBe(false)
})
