/** 先为整个字号范围预留空间，再应用用户倍率，避免每次放大都被适配抵消。 */
export function fitLyricFontScale(
  requested: number,
  content: { width: number; height: number },
  available: { width: number; height: number }
): number {
  const reserve = Math.min(1,
    available.width / Math.max(1, content.width * 1.5),
    available.height / Math.max(1, content.height * 1.5))
  return requested * reserve
}
