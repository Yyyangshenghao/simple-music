import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKGROUND, normalizeBackground } from './background'

describe('应用背景设置归一化', () => {
  it('缺档与坏值回落默认，数值夹到范围内', () => {
    expect(normalizeBackground(null)).toEqual(DEFAULT_BACKGROUND)
    expect(normalizeBackground({ kind: 'nope', fluidColors: ['#fff'], mediaBlur: 999, mediaDim: -1, solid: 'x', solidColor: 'red' })).toEqual(
      { ...DEFAULT_BACKGROUND, mediaBlur: 40, mediaDim: 0 }
    )
  })

  it('图片/视频槽位为空时回到流体，槽位类型不符则丢弃', () => {
    expect(normalizeBackground({ kind: 'video', video: null }).kind).toBe('fluid')
    expect(normalizeBackground({ kind: 'image', image: { id: 'a.png', kind: 'video', name: 'a' } })).toMatchObject({ kind: 'fluid', image: null })
    expect(normalizeBackground({ kind: 'image', image: { id: 'a.png', kind: 'image', name: 'a' } })).toMatchObject({ kind: 'image', image: { id: 'a.png' } })
  })
})

describe('纯色背景按主题取预设', () => {
  it('预设色调与主题相反时回到主题底色，自定义颜色原样使用', async () => {
    const { solidBackgroundCss, solidBackgroundsFor } = await import('./background')
    expect(solidBackgroundsFor(true).every(item => item.tone !== 'dark')).toBe(true)
    expect(solidBackgroundCss({ solid: 'dusk', solidColor: '#000000' }, false)).toContain('#2c1a3c')
    expect(solidBackgroundCss({ solid: 'dusk', solidColor: '#000000' }, true)).toBe('var(--sm-bg-base)')
    expect(solidBackgroundCss({ solid: 'custom', solidColor: '#123456' }, true)).toBe('#123456')
  })
})
