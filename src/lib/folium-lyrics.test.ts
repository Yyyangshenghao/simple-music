import { describe, it, expect } from 'vitest'
import { foliumLyrics, foliumLineIndex, sanitizeModSettings } from './folium-lyrics'

describe('Folium 歌词数据适配', () => {
  it('保留原生词起止与翻译，不把相对毫秒误作绝对秒', () => {
    const result = foliumLyrics([{ time: 10, text: '逐字' }], [{ time: 10, durationMs: 3000, words: [{ text: '逐', startMs: 100, durationMs: 500 }, { text: '字', startMs: 600, durationMs: 2400 }] }], [{ time: 10, text: 'words' }], [{ time: 10, text: 'zhu zi' }], 100)
    expect(result[0]).toEqual({ fullText: '逐字', startTime: 10, endTime: 13, words: [
      { text: '逐', startTime: 10.1, endTime: 10.6 }, { text: '字', startTime: 10.6, endTime: 13 }
    ], translation: 'words', romanization: 'zhu zi' })
    expect(foliumLineIndex(result, 9)).toBe(-1)
    expect(foliumLineIndex(result, 10)).toBe(0)
  })
  it('旧词数据不能附到不同时刻的新行，纯行歌词可正常显示', () => {
    const result = foliumLyrics([{ time: 4, text: 'new' }, { time: 8, text: 'next' }], [{ time: 0, durationMs: 1000, words: [{ text: 'old', startMs: 0 }] }], [], [], 12)
    expect(result[0].words).toEqual([])
    expect(result[0].endTime).toBe(8)
    expect(result[1].endTime).toBe(12)
  })
})

describe('模组设置项整理', () => {
  it('保留合法字段，丢弃类型不符或缺少默认值的项', () => {
    expect(sanitizeModSettings([
      { key: 'speed', type: 'number', label: '速度', defaultValue: 1, min: 0, max: 2, step: 0.1 },
      { key: 'glow', type: 'boolean', label: { 'zh-CN': '对象标签' }, defaultValue: true },
      { key: 'mode', type: 'select', label: '模式', defaultValue: 'a', options: [{ value: 'a', label: '甲' }, { value: 1 }] },
      { key: 'bad key', type: 'number', defaultValue: 1 },
      { key: 'nan', type: 'number', defaultValue: Number.NaN },
      { key: 'missing', type: 'select', defaultValue: 'z', options: [{ value: 'a' }] },
      { key: '__proto__', type: 'function', defaultValue: 1 },
      null,
    ])).toEqual([
      { key: 'speed', type: 'number', label: '速度', defaultValue: 1, min: 0, max: 2, step: 0.1 },
      { key: 'glow', type: 'boolean', label: 'glow', defaultValue: true },
      { key: 'mode', type: 'select', label: '模式', defaultValue: 'a', options: [{ value: 'a', label: '甲' }] },
    ])
  })

  it('非数组与超长列表受限', () => {
    expect(sanitizeModSettings({ length: 1 })).toEqual([])
    expect(sanitizeModSettings(Array.from({ length: 60 }, (_, i) => ({ key: 'k' + i, type: 'boolean', defaultValue: false })))).toHaveLength(40)
  })
})
