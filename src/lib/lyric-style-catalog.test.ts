import { describe, it, expect } from 'vitest'
import { LYRIC_STYLES, lyricStyleInfo, resolveLyricsView, resolveStyleTuning, resolveTuning, sanitizeTuningPatch, type TuningField } from './lyric-style-catalog'

const fields: TuningField[] = [
  { key: 'speed', type: 'number', label: '速度', min: 0, max: 2, step: 0.1, defaultValue: 1 },
  { key: 'glow', type: 'boolean', label: '辉光', defaultValue: true },
  { key: 'layout', type: 'select', label: '版式', options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }], defaultValue: 'a' },
]

describe('样式参数声明', () => {
  it('只留下有意义的玩法，固定演出细节不再受旧参数影响', () => {
    expect(LYRIC_STYLES.reduce((sum, style) => sum + style.tuning.length, 0)).toBe(15)
    expect(lyricStyleInfo('stage3d').label).toBe('粒光')
    expect(resolveStyleTuning('pop', { camera: false }).camera).toBe(true)
    expect(resolveStyleTuning('partita', { semantic: false }).semantic).toBe(true)
    expect(resolveStyleTuning('fume', { zoom: 1.4, float: 0 }).zoom).toBe(1)
  })
  it('合并的装饰、强拍和氛围档位共同驱动相关效果', () => {
    expect(resolveStyleTuning('tempera', { decor: false })).toMatchObject({ decor: false, echo: false })
    expect(resolveStyleTuning('sonnet', { punch: 0, geometry: false })).toMatchObject({ glitch: false, hud: false })
    expect(resolveStyleTuning('diorama', { ambience: 'quiet' })).toMatchObject({ ripples: false, dust: false })
    expect(resolveStyleTuning('diorama', { ambience: 'water' })).toMatchObject({ ripples: true, dust: false })
  })
  it('缺失或非法值回到默认，数值夹在范围内', () => {
    expect(resolveTuning(fields, undefined)).toEqual({ speed: 1, glow: true, layout: 'a' })
    expect(resolveTuning(fields, { speed: 9, glow: 'yes', layout: 'z', extra: 1 })).toEqual({ speed: 2, glow: true, layout: 'a' })
    expect(resolveTuning(fields, { speed: Number.NaN, glow: false, layout: 'b' })).toEqual({ speed: 1, glow: false, layout: 'b' })
  })

  it('写入只保留声明过的字段', () => {
    expect(sanitizeTuningPatch(fields, { speed: 0.5, unknown: 3, __proto__: { glow: false } })).toEqual({ speed: 0.5 })
    expect(sanitizeTuningPatch(fields, [1, 2])).toEqual({})
  })

  it('内置样式的快捷参数都已声明，未知 id 回落到第一个样式', () => {
    for (const style of LYRIC_STYLES) {
      expect(style.quick.length).toBeLessThanOrEqual(3)
      for (const key of style.quick) expect(style.tuning.some(field => field.key === key)).toBe(true)
    }
    expect(lyricStyleInfo('missing' as never).id).toBe('pop')
  })
})

describe('歌词页实际视图', () => {
  it('逐行模式不受样式影响；动态模式遵循所选样式', () => {
    expect(resolveLyricsView({ mode: 'lyrics', style: 'stage3d' })).toBe('lyrics')
    // 已撤下的样式不再出现在清单里，误传进来的旧 ID 回到默认样式
    expect(LYRIC_STYLES.map(style => style.id)).not.toContain('lumiere')
    expect(LYRIC_STYLES.map(style => style.id)).not.toContain('luminous')
    expect(resolveLyricsView({ mode: 'dynamic', style: 'lumiere' as never })).toBe('pop')
    expect(lyricStyleInfo('tilt' as never).id).toBe('pop')
    expect(resolveLyricsView({ mode: 'dynamic', style: 'stage3d' })).toBe('stage3d')
    expect(resolveLyricsView({ mode: 'dynamic', style: 'diorama' })).toBe('diorama')
    expect(resolveLyricsView({ mode: 'dynamic', style: 'pop' })).toBe('pop')
  })
})
