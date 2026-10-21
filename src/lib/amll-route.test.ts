import { describe, expect, it } from 'vitest'
import { fastestAmllHost, formatAmllLatency } from './amll-route'

describe('AMLL 线路测速', () => {
  it('挑最快的可用线路，不可用的跳过', () => {
    expect(fastestAmllHost([{ id: 'github', ms: 620 }, { id: 'gbclstudio', ms: 120 }, { id: 'bikonoo', ms: null }])).toBe('gbclstudio')
    expect(fastestAmllHost([{ id: 'github', ms: null }, { id: 'bikonoo', ms: 300 }])).toBe('bikonoo')
  })

  it('全部不可用返回 null', () => {
    expect(fastestAmllHost([{ id: 'github', ms: null }])).toBeNull()
    expect(fastestAmllHost([])).toBeNull()
  })

  it('延迟展示：未测为空、不可用、毫秒与秒', () => {
    expect(formatAmllLatency(undefined)).toBe('')
    expect(formatAmllLatency(null)).toBe('不可用')
    expect(formatAmllLatency(240)).toBe('240ms')
    expect(formatAmllLatency(2100)).toBe('2.1s')
  })
})
