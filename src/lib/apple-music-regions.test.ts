import { describe, expect, it } from 'vitest'
import { appleRegionLabel, appleRegionOptions } from './apple-music-regions'

describe('Apple Music 地区', () => {
  it('常用地区用短名称，其余按系统语言补全', () => {
    expect(appleRegionLabel('')).toBe('按网络自动')
    expect(appleRegionLabel('hk')).toBe('中国香港')
    expect(appleRegionLabel('th')).toBe('泰国')
  })

  it('当前地区不在常用列表时补进选项', () => {
    expect(appleRegionOptions('us').some((option) => option.value === 'th')).toBe(false)
    expect(appleRegionOptions('th').at(-1)).toEqual({ value: 'th', label: '泰国' })
    expect(appleRegionOptions('')[0]).toEqual({ value: '', label: '按网络自动' })
  })
})
