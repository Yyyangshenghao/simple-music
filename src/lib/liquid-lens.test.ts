import { describe, expect, it } from 'vitest'
import { lensRect } from './liquid-lens'

describe('lensRect', () => {
  it('未缩放时等于布局矩形', () => {
    expect(lensRect(40, 66, 3, 47, 1, 1)).toEqual({ left: 40, top: 3, width: 66, height: 47 })
  })

  it('以中心为原点放大', () => {
    const rect = lensRect(40, 60, 3, 40, 1.5, 1.25)
    expect(rect.width).toBe(90)
    expect(rect.height).toBe(50)
    expect(rect.left + rect.width / 2).toBe(70)
    expect(rect.top + rect.height / 2).toBe(23)
  })
})
