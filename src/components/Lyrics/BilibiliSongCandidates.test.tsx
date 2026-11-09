import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../types/domain'
import type { TrackMatchResult } from '../../lib/track-match'

const h = vi.hoisted(() => ({
  values: [] as unknown[], stateIndex: 0, refs: [] as Array<{ current: any }>, refIndex: 0,
  effects: [] as Array<() => void | (() => void)>,
  querySongCandidates: vi.fn(), confirmSongCandidate: vi.fn(), confirmed: vi.fn(), busy: vi.fn(),
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.stateIndex++
    if (!(index in h.values)) h.values[index] = typeof initial === 'function' ? initial() : initial
    return [h.values[index], (next: unknown) => { h.values[index] = typeof next === 'function' ? next(h.values[index]) : next }]
  },
  useRef: (initial: unknown) => {
    const index = h.refIndex++
    return h.refs[index] ?? (h.refs[index] = { current: initial })
  },
  useEffect: (effect: typeof h.effects[number]) => h.effects.push(effect),
}))
vi.mock('../../stores/bilibili-covers', () => ({ useBilibiliCoverStore: { getState: () => h } }))

import { BilibiliSongCandidates } from './BilibiliSongCandidates'

const track: Track = { id: 'BV1', source: 'bilibili', provider: 'bilibili', type: 'song', name: '晴天', artist: 'UP', artists: [], duration: 269000 }
const song = (id: string, score: number): TrackMatchResult => ({ score, track: {
  id, source: 'netease', provider: 'netease', type: 'song', name: `晴天${id}`, artist: '周杰伦', artists: [], album: '叶惠美', cover: 'https://example.com/cover.jpg', duration: 269000,
} })
function elements(node: unknown, type: string): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type))
  const element = node as ReactElement<any>
  return element.type === type ? [element, ...elements(element.props.children, type)] : elements(element.props?.children, type)
}
function render() {
  h.stateIndex = 0
  h.refIndex = 0
  h.effects = []
  return BilibiliSongCandidates({ track, disabled: false, onBusyChange: h.busy, onConfirmed: h.confirmed })
}
const flush = async () => { for (let count = 0; count < 8; count++) await Promise.resolve() }

beforeEach(() => {
  vi.resetAllMocks()
  h.values = []
  h.refs = []
  h.querySongCandidates.mockResolvedValue([song('1', 87), song('2', 85), song('3', 83), song('4', 80)])
  h.confirmSongCandidate.mockResolvedValue(undefined)
  h.confirmed.mockResolvedValue(undefined)
})

describe('B 站候选歌曲确认', () => {
  it('最多展示三首及匹配分，读取候选不确认歌曲', async () => {
    render()
    h.effects[0]()
    await flush()
    const view = render()
    expect(elements(view, 'strong').map(item => item.props.children)).toEqual(['晴天1', '晴天2', '晴天3'])
    expect(elements(view, 'span').some(item => item.props.children?.[0] === 87)).toBe(true)
    expect(h.confirmSongCandidate).not.toHaveBeenCalled()
    expect(h.querySongCandidates).toHaveBeenCalledWith(track, false)
  })

  it('确认成功后刷新歌词候选，期间禁用操作，完成后收起候选区', async () => {
    render()
    h.effects[0]()
    await flush()
    elements(render(), 'button')[0].props.onClick()
    expect(h.busy).toHaveBeenCalledWith(true)
    expect(elements(render(), 'button').every(item => item.props.disabled)).toBe(true)
    await flush()
    expect(h.confirmSongCandidate).toHaveBeenCalledWith(track, song('1', 87).track)
    expect(h.confirmed).toHaveBeenCalledOnce()
    expect(h.busy).toHaveBeenLastCalledWith(false)
    expect(render()).toBeNull()
  })

  it('确认失败保留候选并提供重新查找，不误报成功', async () => {
    h.confirmSongCandidate.mockRejectedValue(new Error('候选已过期'))
    render()
    h.effects[0]()
    await flush()
    elements(render(), 'button')[0].props.onClick()
    await flush()
    const view = render()
    expect(elements(view, 'p').some(item => item.props.role === 'alert')).toBe(true)
    expect(elements(view, 'button').some(item => item.props.children === '重新查找')).toBe(true)
    expect(h.confirmed).not.toHaveBeenCalled()
    expect(elements(view, 'strong')).toHaveLength(3)
  })

  it('关闭或切歌后迟到的候选查询不能更新界面', async () => {
    let resolve!: (value: TrackMatchResult[]) => void
    h.querySongCandidates.mockReturnValue(new Promise(done => { resolve = done }))
    render()
    const cleanup = h.effects[0]()
    cleanup?.()
    resolve([song('late', 90)])
    await flush()
    expect(elements(render(), 'strong')).toHaveLength(0)
  })

  it('关闭后迟到的确认结果不刷新已结束的歌词选择会话', async () => {
    let resolve!: () => void
    h.confirmSongCandidate.mockReturnValue(new Promise<void>(done => { resolve = done }))
    render()
    const cleanup = h.effects[0]()
    await flush()
    elements(render(), 'button')[0].props.onClick()
    cleanup?.()
    resolve()
    await flush()
    expect(h.confirmed).not.toHaveBeenCalled()
  })

  it('高置信度已自动识别时不显示额外确认区', async () => {
    h.querySongCandidates.mockResolvedValue([])
    render()
    h.effects[0]()
    await flush()
    expect(render()).toBeNull()
  })
})
