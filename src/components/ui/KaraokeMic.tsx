/** 四角星光：以 (x, y) 为中心、r 为半径的内凹四角星，顺时针绘制。 */
function sparkle(x: number, y: number, r: number): string {
  return `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`
}

/** 实心：话筒头、颈箍、渐细手柄合成一条路径，各段同为顺时针，重叠处不留洞。 */
const MIC_SOLID = [
  'M15.5 2.8A5.7 5.7 0 1 1 15.5 14.2A5.7 5.7 0 1 1 15.5 2.8Z',
  'M14.37 13.03 13.23 14.17 9.83 10.77 10.97 9.63Z',
  'M12.66 13.46 5.74 19.54A.9.9 0 0 1 4.46 18.26L10.54 11.34Z',
].join('')

/** 空心：话筒头圆环、颈箍与手柄轮廓同在一条描边路径里。 */
const MIC_OUTLINE = 'M15.5 3.7A4.8 4.8 0 1 1 15.5 13.3A4.8 4.8 0 1 1 15.5 3.7ZM10.4 10.4 13.6 13.6M11 12 5.1 17.9a.9.9 0 0 0 1 1l5.9-5.9'

const SPARKLES = sparkle(5.6, 5.6, 3.4) + sparkle(19.4, 18.6, 2.3)

/**
 * 伴奏话筒（参考 Apple Music 唱歌图标）：斜握话筒，左上与右下各一颗星光；未用伴奏空心，使用伴奏时实心。
 * 放进 24 网格、带描边设置的 svg。图标色常带透明度，填充与描边分开叠画会在重叠处变亮，
 * 所以话筒只用一条路径：空心只描边，实心只填充；星光单独填充，与话筒不重叠。
 */
export function KaraokeMicShapes({ active = false }: { active?: boolean }) {
  return <>
    {active ? <path d={MIC_SOLID} fill="currentColor" stroke="none" /> : <path d={MIC_OUTLINE} fill="none" />}
    <path d={SPARKLES} fill="currentColor" stroke="none" />
  </>
}
