import { describe, expect, it } from 'vitest'
import {
  shouldAdvanceShuangeClip,
  shouldReleaseShuangeAdvanceLock,
} from './shuange-playback-policy'

const range = { startSec: 30, endSec: 50, kind: 'refrain' as const }

describe('shouldAdvanceShuangeClip', () => {
  it('播放到片段末尾时进入下一首', () => {
    expect(shouldAdvanceShuangeClip(49.7, 'playing', range)).toBe(true)
    expect(shouldAdvanceShuangeClip(49.6, 'playing', range)).toBe(false)
  })

  it('暂停、加载或无有效片段时不推进', () => {
    expect(shouldAdvanceShuangeClip(50, 'paused', range)).toBe(false)
    expect(shouldAdvanceShuangeClip(50, 'loading', range)).toBe(false)
    expect(shouldAdvanceShuangeClip(50, 'playing', null)).toBe(false)
  })

  it('补货后仍停在原卡片时释放推进锁', () => {
    expect(shouldReleaseShuangeAdvanceLock(3, 3, true)).toBe(true)
    expect(shouldReleaseShuangeAdvanceLock(3, 4, true)).toBe(false)
    expect(shouldReleaseShuangeAdvanceLock(3, 3, false)).toBe(false)
  })
})
