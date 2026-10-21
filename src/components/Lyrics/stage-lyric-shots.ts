/**
 * 分镜风格：每句歌词是一个镜头。构图在整首歌上一次性确定（同一首歌每次重播一致），
 * 相邻两句换构图，重复出现的句子沿用第一次的构图（副歌重现时画面"押韵"）。
 * 只产出纯数据，渲染层按帧插值。
 */

export type ShotFraming = 'left-third' | 'right-third' | 'close-up' | 'low-angle' | 'wide'

/** 世界坐标下的取景姿态：x/y 为相对居中位置的偏移，tiltX 为俯仰（负值 = 仰拍）。 */
export interface ShotPose {
  x: number
  y: number
  scale: number
  tiltX: number
}

const FRAMINGS: ShotFraming[] = ['left-third', 'right-third', 'close-up', 'low-angle', 'wide']

export const SHOT_POSES: Record<ShotFraming, ShotPose> = {
  'left-third': { x: -1.7, y: 0.08, scale: 0.94, tiltX: 0 },
  'right-third': { x: 1.7, y: -0.08, scale: 0.94, tiltX: 0 },
  'close-up': { x: 0, y: 0, scale: 1.32, tiltX: 0 },
  'low-angle': { x: 0, y: -0.26, scale: 1.06, tiltX: -0.36 },
  wide: { x: 0, y: 0.46, scale: 0.7, tiltX: 0.08 }
}

/** 用于识别重复句：忽略空白、标点和大小写。 */
export function normalizeShotText(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function hashText(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 为整首歌每一行分配构图。 */
export function planStoryboardShots(lines: readonly { text: string }[]): ShotFraming[] {
  const firstFraming = new Map<string, ShotFraming>()
  const shots: ShotFraming[] = []
  lines.forEach((line, index) => {
    const key = normalizeShotText(line.text)
    const prev = shots[index - 1]
    const remembered = key ? firstFraming.get(key) : undefined
    let framing: ShotFraming
    if (remembered && remembered !== prev) {
      framing = remembered
    } else {
      // 下一句若是重复句，给它要沿用的构图让路，保证副歌重现时能押上。
      const nextKey = normalizeShotText(lines[index + 1]?.text ?? '')
      const reserved = nextKey && nextKey !== key ? firstFraming.get(nextKey) : undefined
      const candidates = FRAMINGS.filter((f) => f !== prev && f !== reserved)
      framing = candidates[hashText(`${index}:${key}`) % candidates.length]
    }
    if (key && !firstFraming.has(key)) firstFraming.set(key, framing)
    shots.push(framing)
  })
  return shots
}

/**
 * 按画面里实际剩下的空间收敛姿态：横移不超过文字两侧的余量，特写放大不超过画面能容下的倍数。
 * textWidth 为当前句宽度，frameWidth 为同一坐标系下的可见画面宽度。
 */
export function fitShotPose(pose: ShotPose, textWidth: number, frameWidth: number): ShotPose {
  const usable = frameWidth * 0.9
  const slack = Math.max(0, usable - textWidth * pose.scale)
  const x = Math.sign(pose.x) * Math.min(Math.abs(pose.x), slack / 2)
  const maxScale = textWidth > 0 ? Math.max(1, usable / textWidth) : pose.scale
  const scale = pose.scale > 1 ? Math.min(pose.scale, maxScale) : pose.scale
  return { x, y: pose.y, scale, tiltX: pose.tiltX }
}

/** 镜头接力的横移方向：新镜头在旧镜头右侧则向左推出（-1），反之向右；同列时按行号交替。 */
export function shotPanDirection(prev: ShotPose, next: ShotPose, index: number): 1 | -1 {
  const dx = next.x - prev.x
  if (Math.abs(dx) > 0.01) return dx > 0 ? -1 : 1
  return index % 2 === 0 ? 1 : -1
}

/** 镜头内慢推：随本句经过的时间缓慢放大，停留越久推得越多；短句不推。 */
export function storyboardDolly(elapsedSec: number, dwellSec: number): number {
  if (!(dwellSec >= 1.2) || elapsedSec <= 0) return 0
  const span = Math.min(dwellSec, 8)
  const progress = Math.min(1, elapsedSec / span)
  const amount = 0.035 + Math.min(1, (span - 1.2) / 4) * 0.045
  // 先快后慢的推进，落点平稳
  return amount * (1 - (1 - progress) ** 2)
}
