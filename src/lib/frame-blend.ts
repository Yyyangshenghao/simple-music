/** 将既有 60fps 的插值比例转换为按实际时间推进，避免丢帧后动效变慢。 */
export function frameBlend(alphaAt60: number, dt: number): number {
  return 1 - Math.pow(1 - alphaAt60, Math.max(0, dt) * 60)
}
