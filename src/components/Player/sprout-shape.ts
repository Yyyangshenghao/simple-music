/**
 * 伴奏浮层外形：上方圆角面板，底部经两段圆滑过渡连到一个包住麦克风的圆。
 * 收起态只剩这个圆，展开态是整块面板；两态命令序列一致，可直接做 path() 插值动画。
 */
export interface SproutGeometry {
  /** 面板宽高 */
  width: number
  height: number
  /** 面板圆角 */
  radius: number
  /** 圆心横坐标（对准麦克风中心） */
  cx: number
  /** 圆半径 */
  bubble: number
  /** 圆心在面板底边以下的距离，小于 bubble 时圆的上部嵌进面板 */
  sink: number
  /** 面板底边与圆之间过渡段的宽度 */
  fillet: number
}

const f = (value: number) => Math.round(value * 100) / 100

/** 圆心纵坐标，即外形总高减去半径。 */
export function sproutCenterY(g: SproutGeometry): number {
  return g.height + g.sink
}

function halfChord(g: SproutGeometry): number {
  return Math.sqrt(Math.max(0, g.bubble * g.bubble - g.sink * g.sink))
}

/** 实际圆心横坐标：离面板左右边太近时收进来，避免过渡段伸进圆角。 */
export function sproutCx(g: SproutGeometry): number {
  const reach = g.radius + halfChord(g) + g.fillet
  return Math.min(Math.max(g.cx, reach), g.width - reach)
}

/** 外形总高：面板加上露在面板下方的圆。 */
export function sproutTotalHeight(g: SproutGeometry): number {
  return g.height + g.sink + g.bubble
}

/**
 * 外形路径
 *
 * @param expanded false 为只剩麦克风外的圆，true 为完整面板
 */
export function sproutPath(g: SproutGeometry, expanded: boolean): string {
  const { bubble: R, sink: k, fillet } = g
  const cy = sproutCenterY(g)
  // 圆与面板底边的交点半宽；过渡段从交点外侧 fillet 处开始，落在交点下方一点的圆周上
  const s = halfChord(g)
  const cx = sproutCx(g)
  const phi = Math.atan2(-k, s) + 0.35
  const px = R * Math.cos(phi)
  const py = cy + R * Math.sin(phi)

  // 收起时面板压成圆顶上的一条线，圆角为 0；过渡段的控制点贴着圆的外切线，近似圆形。
  const r = expanded ? g.radius : 0
  const top = expanded ? 0 : cy - R
  const bottom = expanded ? g.height : cy - R
  const left = expanded ? 0 : cx
  const right = expanded ? g.width : cx
  const joinOut = expanded ? s + fillet : 0
  const ctrlX = expanded ? s : R * 0.8
  const ctrlY = expanded ? g.height : cy - R

  return [
    `M ${f(left + r)} ${f(top)}`,
    `H ${f(right - r)}`,
    `A ${f(r)} ${f(r)} 0 0 1 ${f(right)} ${f(top + r)}`,
    `V ${f(bottom - r)}`,
    `A ${f(r)} ${f(r)} 0 0 1 ${f(right - r)} ${f(bottom)}`,
    `H ${f(cx + joinOut)}`,
    `Q ${f(cx + ctrlX)} ${f(ctrlY)} ${f(cx + px)} ${f(py)}`,
    `A ${f(R)} ${f(R)} 0 1 1 ${f(cx - px)} ${f(py)}`,
    `Q ${f(cx - ctrlX)} ${f(ctrlY)} ${f(cx - joinOut)} ${f(bottom)}`,
    `H ${f(left + r)}`,
    `A ${f(r)} ${f(r)} 0 0 1 ${f(left)} ${f(bottom - r)}`,
    `V ${f(top + r)}`,
    `A ${f(r)} ${f(r)} 0 0 1 ${f(left + r)} ${f(top)}`,
    'Z',
  ].join(' ')
}
