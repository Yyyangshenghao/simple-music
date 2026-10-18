import { describe, expect, it } from 'vitest'
import type { PlaylistSyncSnapshot, PlaylistSyncTrack } from '../types/playlist-sync'
import { planPlaylistSyncMerge, playlistSyncChanges } from './playlist-sync-merge'

function snapshot(ids: string[], name = '歌单'): PlaylistSyncSnapshot {
  return { name, tracks: ids.map(id => ({ source: 'netease', id })), revision: 'revision' }
}

function ids(content: Pick<PlaylistSyncSnapshot, 'tracks'>): string[] {
  return content.tracks.map(track => track.id)
}

describe('歌单快照变更', () => {
  it('分别报告增删和改名，插入或删除其他歌曲不算重排', () => {
    expect(playlistSyncChanges(snapshot(['a', 'b', 'c']), snapshot(['x', 'a', 'c'], '新名称'))).toEqual({
      added: ['x'], removed: ['b'], renamed: true, reordered: false
    })
  })

  it('只比较双方已有歌曲的相对顺序，允许忽略本地排序', () => {
    const base = snapshot(['a', 'b', 'c'])
    const next = snapshot(['c', 'x', 'a'])
    expect(playlistSyncChanges(base, next).reordered).toBe(true)
    expect(playlistSyncChanges(base, next, false)).toEqual({
      added: ['x'], removed: ['b'], renamed: false, reordered: false
    })
  })
})

describe('歌单三方合并', () => {
  it.each(['local', 'cloud'] as const)('自动采用%s单边改名', side => {
    const base = snapshot(['a'])
    const renamed = snapshot(['a'], '新名称')
    const plan = planPlaylistSyncMerge(base, side === 'local' ? renamed : base, side === 'cloud' ? renamed : base)
    expect(plan.content.name).toBe('新名称')
    expect(plan.conflicts).toEqual([])
  })

  it('自动合并独立改名和双方增删，并去重共同新增', () => {
    const plan = planPlaylistSyncMerge(
      snapshot(['a', 'b', 'c']),
      snapshot(['a', 'c', 'x', 'both'], '新名称'),
      snapshot(['a', 'b', 'y', 'both', 'both'])
    )
    expect(plan.content.name).toBe('新名称')
    expect(ids(plan.content)).toEqual(['a', 'x', 'y', 'both'])
    expect(plan.conflicts).toEqual([])
    expect(plan.localChanges).toEqual({ added: ['x', 'both'], removed: ['b'], renamed: true, reordered: false })
    expect(plan.cloudChanges).toEqual({ added: ['y', 'both'], removed: ['c'], renamed: false, reordered: false })
  })

  it('双方在相同位置新增歌曲不产生顺序冲突，结果顺序确定', () => {
    const plan = planPlaylistSyncMerge(snapshot(['a', 'b']), snapshot(['a', 'x', 'b']), snapshot(['a', 'y', 'b']))
    expect(ids(plan.content)).toEqual(['a', 'x', 'y', 'b'])
    expect(plan.conflicts).toEqual([])
  })

  it('双方改成同一个名称不产生冲突', () => {
    const plan = planPlaylistSyncMerge(snapshot(['a']), snapshot(['a'], '相同名称'), snapshot(['a'], '相同名称'))
    expect(plan.content.name).toBe('相同名称')
    expect(plan.conflicts).toEqual([])
  })

  it('不同改名默认采用本地，选择后仍保留冲突供界面展示', () => {
    const base = snapshot(['a'])
    const local = snapshot(['a'], '本地名称')
    const cloud = snapshot(['a'], '云端名称')
    expect(planPlaylistSyncMerge(base, local, cloud).content.name).toBe('本地名称')
    const chosen = planPlaylistSyncMerge(base, local, cloud, true, { name: 'cloud' })
    expect(chosen.content.name).toBe('云端名称')
    expect(chosen.conflicts).toEqual([{ id: 'name', kind: 'name' }])
  })

  it('本地删除与云端移动同一歌曲冲突，可选择删除或保留', () => {
    const base = snapshot(['a', 'b', 'c'])
    const local = snapshot(['a', 'c'])
    const cloud = snapshot(['b', 'a', 'c'])
    const plan = planPlaylistSyncMerge(base, local, cloud)
    expect(ids(plan.content)).toEqual(['a', 'c'])
    expect(plan.conflicts).toEqual([{ id: 'delete:netease:b', kind: 'delete', trackId: 'b' }])
    const chosen = planPlaylistSyncMerge(base, local, cloud, true, { 'delete:netease:b': 'cloud' })
    expect(ids(chosen.content)).toEqual(['b', 'a', 'c'])
    expect(chosen.conflicts).toEqual(plan.conflicts)
  })

  it('云端删除与本地移动同一歌曲冲突，默认保留本地歌曲', () => {
    const base = snapshot(['a', 'b', 'c'])
    const local = snapshot(['b', 'a', 'c'])
    const cloud = snapshot(['a', 'c'])
    const plan = planPlaylistSyncMerge(base, local, cloud)
    expect(ids(plan.content)).toEqual(['b', 'a', 'c'])
    expect(plan.conflicts).toEqual([{ id: 'delete:netease:b', kind: 'delete', trackId: 'b' }])
    expect(ids(planPlaylistSyncMerge(base, local, cloud, true, { 'delete:netease:b': 'cloud' }).content)).toEqual(['a', 'c'])
  })

  it('只为参与顺序逆序的歌曲产生删除冲突', () => {
    const plan = planPlaylistSyncMerge(snapshot(['a', 'b', 'c', 'd']), snapshot(['a', 'b']), snapshot(['b', 'a', 'c', 'd']))
    expect(ids(plan.content)).toEqual(['b', 'a'])
    expect(plan.conflicts).toEqual([])
  })

  it('删除未移动的歌曲不冲突，其他歌曲的增删也不被误判为移动', () => {
    const plan = planPlaylistSyncMerge(snapshot(['a', 'b', 'c', 'd']), snapshot(['a', 'd']), snapshot(['x', 'b', 'c', 'd']))
    expect(ids(plan.content)).toEqual(['x', 'd'])
    expect(plan.conflicts).toEqual([])
  })

  it('采用单边重排，并按另一边下一个保留锚点插入新增歌曲', () => {
    const plan = planPlaylistSyncMerge(snapshot(['a', 'b', 'c']), snapshot(['c', 'a', 'b']), snapshot(['a', 'x', 'b', 'y', 'c', 'z']))
    expect(ids(plan.content)).toEqual(['y', 'c', 'a', 'x', 'b', 'z'])
    expect(plan.conflicts).toEqual([])
  })

  it('双方不同重排产生顺序冲突，选择任一顺序均保留双方新增', () => {
    const base = snapshot(['a', 'b', 'c', 'd'])
    const local = snapshot(['b', 'x', 'a', 'c', 'd'])
    const cloud = snapshot(['a', 'b', 'd', 'y', 'c'])
    const plan = planPlaylistSyncMerge(base, local, cloud)
    expect(ids(plan.content)).toEqual(['b', 'x', 'a', 'y', 'c', 'd'])
    expect(plan.conflicts).toEqual([{ id: 'order', kind: 'order' }])
    const chosen = planPlaylistSyncMerge(base, local, cloud, true, { order: 'cloud' })
    expect(ids(chosen.content)).toEqual(['x', 'a', 'b', 'd', 'y', 'c'])
    expect(chosen.conflicts).toEqual(plan.conflicts)
  })

  it('双方相同重排不冲突，不同新增位置也不影响重排判断', () => {
    const plan = planPlaylistSyncMerge(snapshot(['a', 'b', 'c']), snapshot(['c', 'x', 'a', 'b']), snapshot(['c', 'a', 'y', 'b']))
    expect(ids(plan.content)).toEqual(['c', 'x', 'a', 'y', 'b'])
    expect(plan.conflicts).toEqual([])
  })

  it('QQ 模式忽略本地排序并拉取云端顺序，保留本地新增', () => {
    const plan = planPlaylistSyncMerge(snapshot(['a', 'b', 'c']), snapshot(['b', 'x', 'a', 'c']), snapshot(['a', 'c', 'b']), false)
    expect(ids(plan.content)).toEqual(['x', 'a', 'c', 'b'])
    expect(plan.localChanges.reordered).toBe(false)
    expect(plan.cloudChanges.reordered).toBe(true)
    expect(plan.conflicts).toEqual([])
  })

  it('QQ 模式不会因本地重排阻止云端删除，但仍检测本地删除与云端移动', () => {
    const base = snapshot(['a', 'b', 'c'])
    expect(planPlaylistSyncMerge(base, snapshot(['b', 'a', 'c']), snapshot(['a', 'c']), false).conflicts).toEqual([])
    expect(planPlaylistSyncMerge(base, snapshot(['a', 'c']), snapshot(['b', 'a', 'c']), false).conflicts).toEqual([
      { id: 'delete:netease:b', kind: 'delete', trackId: 'b' }
    ])
  })

  it('云端已有曲目优先保留真实元数据，本地新增保留自身元数据', () => {
    const ref = (id: string, qqId: string, songType: number): PlaylistSyncTrack => ({ source: 'qq', id, qqId, songType })
    const base = { ...snapshot([]), tracks: [ref('a', 'old', 0)] }
    const local = { ...base, tracks: [ref('a', 'local', 0), ref('new', 'local-new', 3)] }
    const cloud = { ...base, tracks: [ref('a', 'real', 5)] }
    expect(planPlaylistSyncMerge(base, local, cloud).content.tracks).toEqual([ref('a', 'real', 5), ref('new', 'local-new', 3)])
  })

  it('以来源和字符串 ID 识别歌曲并保留不同来源的同 ID 歌曲', () => {
    const local = snapshot(['same', 'same'])
    const cloud = { ...snapshot([]), tracks: [{ source: 'qq' as const, id: 'same' }] }
    expect(planPlaylistSyncMerge(snapshot([]), local, cloud).content.tracks).toEqual([
      { source: 'netease', id: 'same' }, { source: 'qq', id: 'same' }
    ])
  })

  it('不修改输入，输出曲目也不共享可变引用', () => {
    const base = snapshot(['a', 'b'])
    const local = snapshot(['b', 'a', 'x'], '本地名称')
    const cloud = snapshot(['a', 'y'])
    const before = structuredClone({ base, local, cloud })
    const plan = planPlaylistSyncMerge(base, local, cloud)
    expect({ base, local, cloud }).toEqual(before)
    plan.content.tracks[0].id = 'changed'
    expect({ base, local, cloud }).toEqual(before)
  })

  it('处理万首歌单的反向重排与逐曲删除冲突，不丢失歌曲', () => {
    const allIds = Array.from({ length: 10000 }, (_, index) => String(index))
    const base = snapshot(allIds)
    const cloud = snapshot([...allIds].reverse())
    expect(playlistSyncChanges(base, cloud).reordered).toBe(true)
    const plan = planPlaylistSyncMerge(base, snapshot([]), cloud)
    expect(plan.conflicts).toHaveLength(allIds.length)
    expect(plan.content.tracks).toEqual([])
    const choices = Object.fromEntries(allIds.map(id => [`delete:netease:${id}`, 'cloud' as const]))
    expect(ids(planPlaylistSyncMerge(base, snapshot([]), cloud, true, choices).content)).toEqual([...allIds].reverse())
  })

  it('穷举四首歌的单边删除与排列，另一端未修改时完整采用该侧内容', () => {
    const baseIds = ['a', 'b', 'c', 'd']
    const permutations = (values: string[]): string[][] => values.length
      ? values.flatMap((value, index) => permutations(values.filter((_, other) => other !== index)).map(rest => [value, ...rest]))
      : [[]]
    const base = snapshot(baseIds)
    let cases = 0
    for (let mask = 0; mask < 16; mask++) {
      for (const order of permutations(baseIds.filter((_, index) => mask & (1 << index)))) {
        const expected = [...order]
        expected.splice(Math.floor(order.length / 2), 0, 'new')
        const changed = snapshot([...expected, 'new'], '单边名称')
        for (const side of ['local', 'cloud']) {
          const plan = planPlaylistSyncMerge(base, side === 'local' ? changed : base, side === 'cloud' ? changed : base)
          expect(plan.content.name).toBe(changed.name)
          expect(ids(plan.content)).toEqual(expected)
          expect(plan.conflicts).toEqual([])
          cases++
        }
      }
    }
    expect(cases).toBe(130)
  })

  it('穷举双方独立删除组合，保留双方新增并去重，删别歌不制造冲突', () => {
    const baseIds = ['a', 'b', 'c', 'd']
    const base = snapshot(baseIds)
    for (let localMask = 0; localMask < 16; localMask++) {
      for (let cloudMask = 0; cloudMask < 16; cloudMask++) {
        const local = snapshot(['local-new', ...baseIds.filter((_, index) => localMask & (1 << index)), 'both-new', 'both-new'])
        const cloud = snapshot(['cloud-new', 'both-new', ...baseIds.filter((_, index) => cloudMask & (1 << index))])
        const before = structuredClone({ base, local, cloud })
        const plan = planPlaylistSyncMerge(base, local, cloud)
        const result = ids(plan.content)
        const retained = baseIds.filter((_, index) => (localMask & cloudMask) & (1 << index))
        expect(new Set(result)).toEqual(new Set([...retained, 'local-new', 'cloud-new', 'both-new']))
        expect(result).toHaveLength(retained.length + 3)
        expect(result.filter(id => baseIds.includes(id))).toEqual(retained)
        expect(plan.conflicts).toEqual([])
        expect({ base, local, cloud }).toEqual(before)
      }
    }
  })

  it('QQ的全部三首双端排列组合采用云端旧歌顺序，独立新增始终保留', () => {
    const base = snapshot(['a', 'b', 'c'])
    const orders = [['a', 'b', 'c'], ['a', 'c', 'b'], ['b', 'a', 'c'], ['b', 'c', 'a'], ['c', 'a', 'b'], ['c', 'b', 'a']]
    for (const localOrder of orders) {
      for (const cloudOrder of orders) {
        const plan = planPlaylistSyncMerge(base, snapshot(['local-new', ...localOrder]), snapshot([...cloudOrder, 'cloud-new']), false)
        const result = ids(plan.content)
        expect(result.filter(id => ['a', 'b', 'c'].includes(id))).toEqual(cloudOrder)
        expect(new Set(result)).toEqual(new Set(['a', 'b', 'c', 'local-new', 'cloud-new']))
        expect(result).toHaveLength(5)
        expect(plan.localChanges.reordered).toBe(false)
        expect(plan.conflicts).toEqual([])
      }
    }
  })
})
