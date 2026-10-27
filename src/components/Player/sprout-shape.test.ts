import { expect, it } from 'vitest'
import { sproutCenterY, sproutCx, sproutPath, sproutTotalHeight, type SproutGeometry } from './sprout-shape'

const g: SproutGeometry = { width: 360, height: 400, radius: 20, cx: 180, bubble: 22, sink: 14, fillet: 10 }
const commands = (d: string) => d.replace(/[-\d.\s]+/g, '')
const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number)
/** 依次走过路径，收集所有端点与控制点。 */
function points(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let x = 0, y = 0
  for (const [, cmd, rest] of d.matchAll(/([MHVLQAZ])([^MHVLQAZ]*)/g)) {
    const n = rest.trim() ? rest.trim().split(/\s+/).map(Number) : []
    if (cmd === 'M' || cmd === 'L') [x, y] = n
    else if (cmd === 'H') x = n[0]
    else if (cmd === 'V') y = n[0]
    else if (cmd === 'Q') { out.push([n[0], n[1]]); [x, y] = [n[2], n[3]] }
    else if (cmd === 'A') [x, y] = [n[5], n[6]]
    else continue
    out.push([x, y])
  }
  return out
}

it('收起与展开两态命令序列和参数个数一致，可直接插值', () => {
  const closed = sproutPath(g, false)
  const open = sproutPath(g, true)
  expect(commands(closed)).toBe(commands(open))
  expect(numbers(closed)).toHaveLength(numbers(open).length)
})

it('展开态覆盖整块面板并在底部包住麦克风', () => {
  const pts = points(sproutPath(g, true))
  expect(Math.min(...pts.map(([x]) => x))).toBe(0)
  expect(Math.max(...pts.map(([x]) => x))).toBe(g.width)
  expect(Math.min(...pts.map(([, y]) => y))).toBe(0)
  // 圆最低点不在端点上，端点都在总高之内
  expect(Math.max(...pts.map(([, y]) => y))).toBeLessThan(sproutTotalHeight(g))
  expect(sproutCenterY(g)).toBe(414)
  expect(sproutTotalHeight(g)).toBe(436)
})

it('收起态只剩圆心附近的一小块', () => {
  for (const [x, y] of points(sproutPath(g, false))) {
    expect(Math.abs(x - g.cx)).toBeLessThanOrEqual(g.bubble)
    expect(Math.abs(y - sproutCenterY(g))).toBeLessThanOrEqual(g.bubble)
  }
})

it('圆心太靠边时收进面板，避开圆角', () => {
  expect(sproutCx({ ...g, cx: 5 })).toBeGreaterThan(g.radius)
  expect(sproutCx({ ...g, cx: 355 })).toBeLessThan(g.width - g.radius)
  expect(sproutCx(g)).toBe(180)
})
