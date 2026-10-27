import { describe, expect, it } from 'vitest'
import { karaokeResources } from './karaoke-resources'

const GB = 1024 ** 3

describe('伴奏生成内存准入', () => {
  it.each([32, 64, 128])('%i GB 设备有 5 GB 可用时，不因按总量放大预留而永久等待', (total) => {
    const resources = karaokeResources('hq3', 180000, { total: total * GB, free: 5 * GB })
    expect(resources.canStart).toBe(true)
    expect(resources.requiredBytes).toBeLessThan(4.5 * GB)
  })

  it.each([8, 16, 32, 64])('%i GB 设备实际可用不足时仍拒绝启动', (total) => {
    expect(karaokeResources('hq3', 180000, { total: total * GB, free: 2 * GB }).canStart).toBe(false)
    expect(karaokeResources('hq3-fp16', 180000, { total: total * GB, free: 512 * 1024 ** 2 }).canStart).toBe(false)
  })

  it('仍计入音频长度，长音频不能沿用短音频的通过结果', () => {
    const memory = { total: 32 * GB, free: 5 * GB }
    expect(karaokeResources('hq3', 180000, memory).canStart).toBe(true)
    expect(karaokeResources('hq3', 1800000, memory).canStart).toBe(false)
  })
})
