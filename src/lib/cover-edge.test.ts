import { describe, expect, it } from 'vitest'
import { buildEdgeDepthData } from './cover-edge'

/** 构造 W×H 的 RGBA 灰度图,fill(x,y) 返回 0-255 灰度值 */
function makeGray(W: number, H: number, fill: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = fill(x, y)
      const di = (y * W + x) * 4
      data[di] = data[di + 1] = data[di + 2] = v
      data[di + 3] = 255
    }
  }
  return data
}

describe('buildEdgeDepthData', () => {
  it('输出 RGBA 尺寸与输入一致', () => {
    const out = buildEdgeDepthData(makeGray(16, 16, () => 128), 16, 16)
    expect(out.length).toBe(16 * 16 * 4)
  })

  it('纯色图无边缘,亮度通道正确', () => {
    const W = 32
    const out = buildEdgeDepthData(makeGray(W, W, () => 200), W, W)
    for (let i = 0; i < W * W; i++) {
      expect(out[i * 4 + 1]).toBe(0) // G=edge
    }
    // A=lum ≈ 200
    expect(Math.abs(out[3] - 200)).toBeLessThanOrEqual(1)
  })

  it('左右分界图在边界附近产生边缘响应,且远离边界处无响应', () => {
    const W = 64
    const out = buildEdgeDepthData(makeGray(W, W, (x) => (x < W / 2 ? 0 : 255)), W, W)
    const y = W >> 1
    let nearBoundary = 0
    for (let x = W / 2 - 6; x < W / 2 + 6; x++) nearBoundary = Math.max(nearBoundary, out[(y * W + x) * 4 + 1])
    expect(nearBoundary).toBeGreaterThan(100)
    expect(out[(y * W + 2) * 4 + 1]).toBe(0)
    expect(out[(y * W + W - 3) * 4 + 1]).toBe(0)
  })

  it('中心深度高于角落(中心偏置)', () => {
    const W = 32
    const out = buildEdgeDepthData(makeGray(W, W, () => 128), W, W)
    const center = out[((W >> 1) * W + (W >> 1)) * 4]
    const corner = out[0]
    expect(center).toBeGreaterThan(corner)
  })
})
