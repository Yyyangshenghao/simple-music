import { describe, it, expect } from 'vitest'
import { formatDuration } from './format-duration'

describe('formatDuration', () => {
  it('按毫秒入参格式化为 m:ss', () => {
    expect(formatDuration(215_000)).toBe('3:35')
    expect(formatDuration(60_000)).toBe('1:00')
    expect(formatDuration(9_000)).toBe('0:09')
    // 曾把毫秒当秒显示过(ca700db):3:35 的歌不能显示成 215:00
    expect(formatDuration(215_000)).not.toBe('215:00')
  })

  it('秒数四舍五入', () => {
    expect(formatDuration(59_600)).toBe('1:00')
    expect(formatDuration(59_400)).toBe('0:59')
  })

  it('超过一小时按总分钟数显示', () => {
    expect(formatDuration(3_725_000)).toBe('62:05')
  })

  it('缺失/非法时长回退到 empty 参数', () => {
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(-1)).toBe('')
    expect(formatDuration(undefined, '--:--')).toBe('--:--')
  })
})
