import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKaraokeQueue, KARAOKE_PLAYED_KEY, KARAOKE_QUEUE_KEY, type KaraokeQueueDependencies } from './queue'
import { karaokeResources } from '../../../server/lib/karaoke-resources'
import type { Track } from '../../types/domain'
import type { Accompaniment } from '../../types/karaoke'

const song = (id: number): Track => ({ provider: 'netease', source: 'netease', type: 'song', id, name: `歌曲${id}`, artist: '歌手', artists: [], duration: 180000, url: 'https://expired.example/song' })
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
function setup(stored?: string) {
  const archive = new Map(stored ? [[KARAOKE_QUEUE_KEY, stored]] : [])
  const completions: Array<{ resolve(value: string): void; signal: AbortSignal; progress: Parameters<KaraokeQueueDependencies['port']['separate']>[3] }> = []
  let items: Accompaniment[] = []
  let dir = '/songs'
  const deps: KaraokeQueueDependencies = {
    storage: () => ({ getItem: key => archive.get(key) ?? null, setItem: (key, value) => { archive.set(key, value) } }),
    library: vi.fn(async () => ({ directory: dir, items })),
    resources: vi.fn(async () => ({ canStart: true, availableBytes: 8e9, requiredBytes: 3e9 })),
    resolve: vi.fn(async track => ({ key: `netease:${String(track.id)}`, src: 'https://fresh.example/song' })),
    port: {
      supported: vi.fn(async () => true), knownStem: () => null, forget: vi.fn(), release: vi.fn(),
      separate: vi.fn((_model, _key, _src, progress, signal) => new Promise<string>((resolve, reject) => {
        completions.push({ resolve, signal, progress })
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })),
    },
    save: vi.fn(async (job, key) => {
      const item: Accompaniment = { id: `${key}-${job.model}`, track: job.track, key, model: job.model, directory: job.directory, fileName: 'song.wav', bytes: 100, generatedAt: 1, available: true }
      items = [...items.filter(existing => existing.id !== item.id), item]
      return item
    }),
    directory: vi.fn(async value => { dir = value }), remove: vi.fn(async item => { items = items.filter(existing => existing.id !== item.id) }),
  }
  const queue = createKaraokeQueue(deps)
  const stop = queue.start()
  return { ...queue, stop, deps, completions, archive }
}
afterEach(() => vi.useRealTimers())

describe('独立伴奏生成队列', () => {
  it('QQ 补齐 mid 前后，同一歌曲同一模型不会重复入队或重做已有成品', async () => {
    const q = setup()
    q.store.getState().setPaused(true)
    const track: Track = { ...song(1), provider: 'qq', source: 'qq' }
    await q.store.getState().enqueue(track, 'hq3')
    await q.store.getState().enqueue({ ...track, mid: 'same-song' }, 'hq3')
    expect(q.store.getState().jobs).toHaveLength(1)
    const saved: Accompaniment = { id: 'saved', track, key: 'qq:1', model: 'kara2', directory: '/songs', fileName: 'song.wav', bytes: 100, generatedAt: 1, available: true }
    vi.mocked(q.deps.library).mockResolvedValue({ directory: '/songs', items: [saved] })
    await q.store.getState().enqueue({ ...track, mid: 'same-song' }, 'kara2')
    expect(q.store.getState().jobs).toHaveLength(1)
    q.stop()
  })
  it('只在显式入队后逐首生成；等待项不解析音源，不使用旧播放 URL', async () => {
    vi.useFakeTimers()
    const q = setup()
    await flush()
    expect(q.deps.resolve).not.toHaveBeenCalled()
    await q.store.getState().enqueue(song(1), 'hq3')
    await q.store.getState().enqueue(song(2), 'kara2')
    await flush()
    expect(q.deps.resolve).toHaveBeenCalledTimes(1)
    expect(q.deps.resolve).toHaveBeenCalledWith(expect.not.objectContaining({ url: expect.anything() }), expect.any(AbortSignal))
    q.completions[0].resolve('/stem')
    await flush()
    expect(q.deps.port.release).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(q.deps.resolve).toHaveBeenCalledTimes(2)
    expect(q.store.getState().items).toHaveLength(1)
    expect(q.store.getState().jobs).toHaveLength(1)
    q.stop()
    await flush()
  })

  it('暂停只拦后续任务；同曲同模型去重，其他模型独立排队', async () => {
    vi.useFakeTimers()
    const q = setup()
    await q.store.getState().enqueue(song(1), 'hq3')
    await q.store.getState().enqueue(song(1), 'hq3')
    await q.store.getState().enqueue(song(1), 'kara2')
    await flush()
    expect(q.store.getState().jobs).toHaveLength(2)
    q.store.getState().setPaused(true)
    expect(q.completions[0].signal.aborted).toBe(false)
    q.completions[0].resolve('/stem')
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(q.deps.port.separate).toHaveBeenCalledTimes(1)
    q.store.getState().setPaused(false)
    await flush()
    expect(q.deps.port.separate).toHaveBeenCalledTimes(2)
    q.stop()
    await flush()
  })

  it('取消当前任务释放资源，迟到进度和结果不写入库', async () => {
    vi.useFakeTimers()
    const q = setup()
    await q.store.getState().enqueue(song(1), 'hq3')
    await flush()
    q.store.getState().cancel(q.store.getState().jobs[0].id)
    q.completions[0].progress({ phase: 'separating', progress: 0.9 })
    q.completions[0].resolve('/late')
    await flush()
    expect(q.deps.port.release).toHaveBeenCalled()
    expect(q.deps.save).not.toHaveBeenCalled()
    expect(q.store.getState().jobs).toEqual([])
    q.stop()
  })

  it('内存不足时不解析或加载模型，恢复后再处理', async () => {
    vi.useFakeTimers()
    const q = setup()
    vi.mocked(q.deps.resources).mockResolvedValueOnce({ canStart: false, availableBytes: 1e9, requiredBytes: 3e9 })
    await q.store.getState().enqueue(song(1), 'hq3')
    await flush()
    expect(q.store.getState().jobs[0].phase).toBe('waiting-memory')
    expect(q.deps.resolve).not.toHaveBeenCalled()
    expect(q.deps.port.separate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(q.deps.port.separate).toHaveBeenCalledTimes(1)
    q.stop()
    await flush()
  })

  it('32 GB 设备可用内存从 4 GB 恢复至 5 GB，已有等待任务自动开始', async () => {
    vi.useFakeTimers()
    const q = setup()
    let free = 4 * 1024 ** 3
    vi.mocked(q.deps.resources).mockImplementation(async (model, duration) => karaokeResources(model, duration, { total: 32 * 1024 ** 3, free }))
    await q.store.getState().enqueue(song(1), 'hq3')
    await flush()
    expect(q.store.getState().jobs[0].phase).toBe('waiting-memory')
    free = 5 * 1024 ** 3
    await vi.advanceTimersByTimeAsync(5000)
    expect(q.deps.port.separate).toHaveBeenCalledOnce()
    q.stop()
    await flush()
  })

  it('改保存目录只影响之后加入的任务，退出后恢复为暂停', async () => {
    vi.useFakeTimers()
    const q = setup()
    q.store.getState().setPaused(true)
    await q.store.getState().enqueue(song(1), 'hq3')
    await q.store.getState().setDirectory('/new')
    await q.store.getState().enqueue(song(2), 'hq3')
    expect(q.store.getState().jobs.map(job => job.directory)).toEqual(['/songs', '/new'])
    q.stop()
    const restored = setup(q.archive.get(KARAOKE_QUEUE_KEY))
    await flush()
    expect(restored.store.getState().paused).toBe(true)
    expect(restored.store.getState().jobs).toHaveLength(2)
    expect(restored.deps.resolve).not.toHaveBeenCalled()
    restored.stop()
  })

  it('没有 WebGPU 时保留可重试失败，不使用音效伪装生成成功', async () => {
    const q = setup()
    vi.mocked(q.deps.port.supported).mockResolvedValue(false)
    await q.store.getState().enqueue(song(1), 'hq3')
    await flush()
    expect(q.store.getState().jobs[0]).toMatchObject({ phase: 'failed', error: expect.stringContaining('WebGPU') })
    expect(q.deps.port.separate).not.toHaveBeenCalled()
    q.stop()
  })

  it('旧目录读取尚未结束时换目录，会丢弃旧结果并补读新目录', async () => {
    const q = setup()
    await flush()
    let finish!: (value: { directory: string; items: Accompaniment[] }) => void
    vi.mocked(q.deps.library).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const old = q.store.getState().load()
    const change = q.store.getState().setDirectory('/new')
    await flush()
    finish({ directory: '/old', items: [] })
    await old
    await change
    expect(q.store.getState()).toMatchObject({ loaded: true, directory: '/new' })
    expect(q.deps.library).toHaveBeenCalledTimes(3)
    q.stop()
  })

  it('旧读取失败也不阻止切换后重新读取新目录', async () => {
    const q = setup()
    await flush()
    let fail!: (error: Error) => void
    vi.mocked(q.deps.library).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const old = q.store.getState().load().catch(() => {})
    const change = q.store.getState().setDirectory('/new')
    await flush()
    fail(new Error('旧目录读取失败'))
    await old
    await change
    expect(q.store.getState()).toMatchObject({ loaded: true, directory: '/new', error: '' })
    q.stop()
  })

  it('坏队列不会被新任务覆盖，成功读取伴奏库也保留恢复错误', async () => {
    const q = setup('broken')
    await flush()
    expect(q.store.getState().error).toContain('存档无法读取')
    await expect(q.store.getState().enqueue(song(1), 'hq3')).rejects.toThrow('旧生成队列无法读取')
    expect(q.archive.get(KARAOKE_QUEUE_KEY)).toBe('broken')
    q.stop()
  })

  it('退出时保存已在服务端成功，恢复后识别成品而不重新推理', async () => {
    const q = setup()
    let finish!: (item: Accompaniment) => void
    vi.mocked(q.deps.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await q.store.getState().enqueue(song(1), 'hq3')
    await flush()
    q.completions[0].resolve('/stem')
    await flush()
    expect(q.store.getState().jobs[0].phase).toBe('saving')
    q.stop()
    const item: Accompaniment = { id: 'saved', key: 'netease:1', model: 'hq3', track: song(1), directory: '/songs', fileName: 'song.wav', bytes: 100, generatedAt: 1, available: true }
    finish(item)
    await flush()
    vi.mocked(q.deps.library).mockResolvedValue({ directory: '/songs', items: [item] })
    const restored = createKaraokeQueue(q.deps)
    const stop = restored.start()
    await flush()
    restored.store.getState().setPaused(false)
    await flush()
    expect(restored.store.getState().jobs).toEqual([])
    expect(q.deps.port.separate).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('伴奏播放记录', () => {
  it('记录最近播放时间并在重启后恢复，删除伴奏时一并清除，损坏条目被忽略', async () => {
    vi.useFakeTimers({ now: 1000 })
    const q = setup()
    const a = 'a'.repeat(40), b = 'b'.repeat(40)
    q.store.getState().markPlayed(a)
    vi.setSystemTime(2000)
    q.store.getState().markPlayed(b)
    expect(q.store.getState().played).toEqual({ [a]: 1000, [b]: 2000 })
    q.archive.set(KARAOKE_PLAYED_KEY, JSON.stringify({ ...JSON.parse(q.archive.get(KARAOKE_PLAYED_KEY)!), bad: 1, [b.replace('b', 'c')]: 'x' }))
    q.stop()
    const restored = createKaraokeQueue(q.deps)
    restored.start()
    expect(restored.store.getState().played).toEqual({ [a]: 1000, [b]: 2000 })
    restored.store.setState({ items: [{ id: a, track: song(1), key: 'netease:1', model: 'hq3', directory: '/songs', fileName: 'a.wav', bytes: 1, generatedAt: 1, available: true }] })
    await restored.store.getState().remove(a)
    expect(restored.store.getState().played).toEqual({ [b]: 2000 })
    expect(JSON.parse(q.archive.get(KARAOKE_PLAYED_KEY)!)).toEqual({ [b]: 2000 })
  })
})

describe('伴奏会话完成记录', () => {
  it('成功后留存完成记录，不写盘；清除记录不删除成品，重启不恢复记录', async () => {
    vi.useFakeTimers()
    const q = setup()
    await q.store.getState().enqueue(song(1), 'hq3')
    await flush()
    q.completions[0].resolve('/stem')
    await flush()
    const state = q.store.getState()
    expect(state.jobs).toEqual([])
    expect(state.recent).toEqual([expect.objectContaining({ accompanimentId: state.items[0].id, track: expect.objectContaining({ id: 1 }), model: 'hq3' })])
    expect(JSON.parse(q.archive.get(KARAOKE_QUEUE_KEY)!)).not.toHaveProperty('recent')
    q.store.getState().clearRecent()
    expect(q.store.getState().recent).toEqual([])
    expect(q.store.getState().items).toHaveLength(1)
    q.stop()
    const restored = createKaraokeQueue(q.deps)
    const stop = restored.start()
    expect(restored.store.getState().recent).toEqual([])
    stop()
  })
  it('取消不产生完成记录，保存阶段不可取消，删除成品同时清除完成记录', async () => {
    vi.useFakeTimers()
    const q = setup()
    await q.store.getState().enqueue(song(1), 'hq3')
    await flush()
    q.store.getState().cancel(q.store.getState().jobs[0].id)
    q.completions[0].resolve('/late')
    await flush()
    expect(q.store.getState().recent).toEqual([])
    await q.store.getState().enqueue(song(2), 'hq3')
    await flush()
    let finish!: (item: Accompaniment) => void
    vi.mocked(q.deps.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    q.completions[1].resolve('/stem')
    await flush()
    const job = q.store.getState().jobs[0]
    expect(job.phase).toBe('saving')
    q.store.getState().cancel(job.id)
    expect(q.store.getState().jobs).toHaveLength(1)
    const item: Accompaniment = { id: 'saved', track: song(2), key: 'netease:2', model: 'hq3', directory: '/songs', fileName: 'song.wav', bytes: 1, generatedAt: 1, available: true }
    finish(item)
    await flush()
    expect(q.store.getState().recent).toHaveLength(1)
    await q.store.getState().remove(item.id)
    expect(q.store.getState().recent).toEqual([])
    q.stop()
  })
})

it('伴奏最近完成记录最多保留 50 项，旧成品仍在库中', async () => {
  vi.useFakeTimers()
  const q = setup()
  for (let id = 1; id <= 52; id++) {
    await q.store.getState().enqueue(song(id), 'hq3')
    await flush()
    q.completions[id - 1].resolve('/stem')
    await flush()
  }
  expect(q.store.getState().recent).toHaveLength(50)
  expect(q.store.getState().recent.at(-1)?.track.id).toBe(3)
  expect(q.store.getState().items).toHaveLength(52)
  q.stop()
})

it('取消全部等待只移除 queued 和内存等待，当前生成继续且不启动后续任务', async () => {
  vi.useFakeTimers()
  const q = setup()
  await q.store.getState().enqueue(song(1), 'hq3')
  await flush()
  await q.store.getState().enqueue(song(2), 'hq3')
  await q.store.getState().enqueue(song(3), 'hq3')
  q.store.setState(state => ({ jobs: state.jobs.map(job => job.track.id === 3 ? { ...job, phase: 'waiting-memory' } : job) }))
  q.store.getState().cancelWaiting()
  expect(q.store.getState().jobs.map(job => job.track.id)).toEqual([1])
  expect(q.completions[0].signal.aborted).toBe(false)
  expect(JSON.parse(q.archive.get(KARAOKE_QUEUE_KEY)!).jobs).toHaveLength(1)
  q.completions[0].resolve('/stem')
  await flush()
  await vi.advanceTimersByTimeAsync(1000)
  expect(q.deps.resolve).toHaveBeenCalledTimes(1)
  expect(q.store.getState().recent).toHaveLength(1)
  q.stop()
})
