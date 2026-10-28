import { describe, expect, it } from 'vitest'
import { lensOutline, lensRect } from './liquid-lens'

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

const points = (path: string) => [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(match => [Number(match[1]), Number(match[2])])

describe('流体轮廓', () => {
  const rect = { left: 0, top: 0, width: 90, height: 66 }

  it('局部形变打破上下对称，且弹簧过冲不会让轮廓超出画布', () => {
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const path = lensOutline(rect, x, y)
      expect(lensOutline(rect, x * 2, y * 2)).toBe(path)
      for (const [px, py] of points(path)) {
        expect(px).toBeGreaterThanOrEqual(0)
        expect(px).toBeLessThanOrEqual(rect.width)
        expect(py).toBeGreaterThanOrEqual(0)
        expect(py).toBeLessThanOrEqual(rect.height)
      }
    }
    const warped = points(lensOutline(rect, 1, 1))
    expect(warped.some(([x, y]) => !warped.some(([otherX, otherY]) => Math.abs(otherX - x) < 0.1 && Math.abs(otherY - (66 - y)) < 0.1))).toBe(true)
  })

  it('抵消 CSS 缩放后，轮廓与 WebGL 的世界尺寸保持一致', () => {
    const world = points(lensOutline(rect, 0.7, -0.5))
    const local = points(lensOutline(rect, 0.7, -0.5, 1.3, 1.42))
    local.forEach(([x, y], i) => {
      expect(x * 1.3).toBeCloseTo(world[i][0], 1)
      expect(y * 1.42).toBeCloseTo(world[i][1], 1)
    })
  })

  it('沉下时洞与局部形变一起收拢，收完不再挖空', () => {
    const full = points(lensOutline(rect, 0.7, -0.5))
    const closing = points(lensOutline({ ...rect, width: 22.5, height: 16.5 }, 0.175, -0.125))
    closing.forEach(([x, y], i) => {
      expect(x * 4).toBeCloseTo(full[i][0], 1)
      expect(y * 4).toBeCloseTo(full[i][1], 1)
    })
    expect(lensOutline({ ...rect, width: 0, height: 0 })).toBe('')
  })
})
