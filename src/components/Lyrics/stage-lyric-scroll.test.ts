import { describe, expect, it } from 'vitest'
import { advanceLyricScroll } from './stage-lyric-scroll'

function run(fps: number, seconds: number, target: number, start = { position: 0, velocity: 0 }) {
  let state = start
  for (let i = 0; i < fps * seconds; i++) {
    state = advanceLyricScroll(state.position, state.velocity, target, 1 / fps, 11)
  }
  return state
}

describe('advanceLyricScroll', () => {
  it('30/60/120 帧下走过相同位置，且逐渐停在下一句', () => {
    const a = run(30, 0.5, 1)
    const b = run(60, 0.5, 1)
    const c = run(120, 0.5, 1)
    expect(a.position).toBeCloseTo(b.position, 5)
    expect(b.position).toBeCloseTo(c.position, 5)
    expect(a.position).toBeGreaterThan(0.9)
    expect(a.position).toBeLessThan(1)
  })

  it('滚动途中反向跳到上一句时沿用速度并平稳收敛', () => {
    const forward = run(60, 0.2, 1)
    const next = advanceLyricScroll(forward.position, forward.velocity, -1, 1 / 60, 11)
    expect(Math.abs(next.position - forward.position)).toBeLessThan(0.05)
    expect(run(60, 1, -1, next).position).toBeCloseTo(-1, 2)
  })
})
