/** 精确积分的临界阻尼滚动；切句时可沿用当前速度，且不依赖屏幕刷新率。 */
export function advanceLyricScroll(position: number, velocity: number, target: number, dt: number, response: number) {
  const omega = Math.max(0.01, response)
  const elapsed = Math.max(0, dt)
  const error = position - target
  const impulse = (velocity + omega * error) * elapsed
  const decay = Math.exp(-omega * elapsed)
  return {
    position: target + (error + impulse) * decay,
    velocity: (velocity - omega * impulse) * decay
  }
}
