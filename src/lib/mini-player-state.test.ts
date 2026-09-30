import { describe, expect, it } from 'vitest'
import { DEFAULT_MINI_PLAYER_APPEARANCE } from './mini-player-config'
import { mergeMiniPlayerPayload, miniPlayerPatch } from './mini-player-state'

describe('迷你条状态增量', () => {
  const previous = { trackTitle: '歌曲', position: 10, appearance: DEFAULT_MINI_PLAYER_APPEARANCE }

  it('只产生实际变化字段', () => {
    expect(miniPlayerPatch(previous, { ...previous, position: 11 })).toEqual({ position: 11 })
  })

  it('重复快照不创建新状态或外观对象', () => {
    expect(mergeMiniPlayerPayload(previous, { ...previous, appearance: { ...previous.appearance } })).toBe(previous)
  })

  it('进度增量保持静态字段与外观引用', () => {
    const merged = mergeMiniPlayerPayload(previous, { position: 12 })
    expect(merged).toEqual({ ...previous, position: 12 })
    expect(merged.appearance).toBe(previous.appearance)
  })

  it('外观变更与显式清空字段仍可应用', () => {
    const appearance = { ...previous.appearance, showProgress: false }
    expect(miniPlayerPatch(previous, { appearance, trackTitle: '' })).toEqual({ appearance, trackTitle: '' })
    expect(mergeMiniPlayerPayload(previous, { appearance: undefined }).appearance).toBeUndefined()
  })
})
