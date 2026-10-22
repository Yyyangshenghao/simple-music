import { describe, it, expect } from 'vitest'
import { contrastOn, luminance, mixRgb, parseCssColor, rgbCss } from './canvas-color'

describe('Canvas 颜色工具', () => {
  it('解析 rgb()、rgba()、color(srgb …) 与十六进制，无法识别时用后备色', () => {
    expect(parseCssColor('rgb(10, 20, 30)')).toEqual([10, 20, 30])
    expect(parseCssColor('rgba(10 20 30 / 0.5)')).toEqual([10, 20, 30])
    expect(parseCssColor('color(srgb 1 0.5 0)')).toEqual([255, 128, 0])
    expect(parseCssColor('#ff8000')).toEqual([255, 128, 0])
    expect(parseCssColor('oklch(0.5 0.1 20)', [1, 2, 3])).toEqual([1, 2, 3])
  })

  it('混色、亮度与对比色选择', () => {
    expect(mixRgb([255, 255, 255], [0, 0, 0], 0.5)).toEqual([128, 128, 128])
    expect(luminance([255, 255, 255])).toBeCloseTo(1)
    expect(luminance([0, 0, 0])).toBe(0)
    expect(contrastOn([250, 200, 230], [255, 255, 255], [20, 20, 25])).toEqual([20, 20, 25])
    expect(contrastOn([30, 10, 60], [255, 255, 255], [20, 20, 25])).toEqual([255, 255, 255])
    expect(rgbCss([1, 2, 3])).toBe('rgb(1, 2, 3)')
    expect(rgbCss([1, 2, 3], 0.5)).toBe('rgba(1, 2, 3, 0.5)')
  })
})
