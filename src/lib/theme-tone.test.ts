import { describe, expect, it } from 'vitest'
import { accentTokensFor, lumaStatsFromPixels, mediaTone, scrimOpacity } from './theme-tone'

const flat = (luma: number) => ({ mean: luma, high: luma, low: luma })

describe('背景自适应遮罩', () => {
  it('同一张亮图：深色主题自动压暗，浅色主题几乎不加', () => {
    const bright = flat(0.85)
    const dark = scrimOpacity(bright, false, 0)
    const lightTheme = scrimOpacity(bright, true, 0)
    expect(dark).toBeGreaterThan(0.6)
    expect(lightTheme).toBe(0)
    // 叠完遮罩后的有效亮度落到可读上限以内
    expect(0.85 * (1 - dark) + (12 / 255) * dark).toBeLessThanOrEqual(0.3501)
  })

  it('同一张暗图：浅色主题自动提亮，深色主题不加', () => {
    const night = flat(0.1)
    expect(scrimOpacity(night, false, 0)).toBe(0)
    const a = scrimOpacity(night, true, 0)
    expect(a).toBeLessThanOrEqual(0.75)
    expect(0.1 * (1 - a) + (240 / 255) * a).toBeGreaterThanOrEqual(0.6)
  })

  it('中等亮度的照片两种主题下都留出大半画面', () => {
    const photo = { mean: 0.48, high: 0.77, low: 0.19 }
    expect(scrimOpacity(photo, true, 0.1)).toBeLessThan(0.5)
    expect(scrimOpacity(photo, false, 0.1)).toBeLessThan(0.5)
  })

  it('浅色主题用 gamma 提亮保色，只补少量白色遮罩；深色主题不加滤镜', () => {
    const photo = { mean: 0.48, high: 0.77, low: 0.19 }
    const lightTone = mediaTone(photo, true, 0)
    expect(lightTone.gamma).toBeLessThan(1)
    expect(lightTone.gamma).toBeGreaterThanOrEqual(0.72)
    expect(lightTone.scrim).toBeLessThan(0.15)
    expect(mediaTone(photo, false, 0)).toEqual({ scrim: scrimOpacity(photo, false, 0), gamma: 1, saturate: 1 })
    // 本就够亮的图不动
    expect(mediaTone(flat(0.85), true, 0)).toEqual({ scrim: 0, gamma: 1, saturate: 1 })
  })

  it('用户额外强度叠在自动值之上，结果不超过 1', () => {
    expect(scrimOpacity(flat(0.1), false, 0.3)).toBeCloseTo(0.3)
    const auto = scrimOpacity(flat(0.9), false, 0)
    expect(scrimOpacity(flat(0.9), false, 0.5)).toBeCloseTo(auto + (1 - auto) * 0.5)
    expect(scrimOpacity(flat(1), false, 5)).toBe(1)
  })

  it('像素统计给出均值与 10/90 分位', () => {
    const px = [0, 0, 0, 255, 255, 255, 255, 255]
    const stats = lumaStatsFromPixels(px)
    expect(stats.mean).toBeCloseTo(0.5)
    expect(stats.low).toBe(0)
    expect(stats.high).toBeCloseTo(1)
    expect(lumaStatsFromPixels([])).toEqual({ mean: 0, high: 0, low: 0 })
  })
})

describe('主题色按主题适配', () => {
  it('深色主题把暗色调亮、浅色主题把亮色调暗，按钮文字取对比高者', () => {
    const onDark = accentTokensFor('#1e1b4b', false)!
    const onLight = accentTokensFor('#fde047', true)!
    expect(onDark.accent).not.toBe('#1e1b4b')
    expect(onLight.accent).not.toBe('#fde047')
    expect(accentTokensFor('#fde047', false)!.onAccent).toBe('#0c0c0c')
    expect(accentTokensFor('#1e1b4b', true)!.onAccent).toBe('#ffffff')
  })

  it('封面取色的 rgb() 也能解析，非法值返回 null', () => {
    expect(accentTokensFor('rgb(14, 165, 233)', false)).not.toBeNull()
    expect(accentTokensFor('red', false)).toBeNull()
  })
})
