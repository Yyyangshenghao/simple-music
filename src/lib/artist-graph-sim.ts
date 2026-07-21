import { forceSimulation, forceManyBody, forceCollide, forceLink } from 'd3-force'
import type { Simulation, SimulationNodeDatum, SimulationLinkDatum, ForceLink, ForceCollide } from 'd3-force'

/** 选歌手画布用的力导向仿真封装:排斥(不聚堆)+碰撞(硬性不重叠,弹性回弹)+连线弹簧(子节点被拉在父节点附近)。 */

export interface GraphSimNode extends SimulationNodeDatum {
  id: string
}

export type GraphSimLink<N extends GraphSimNode> = SimulationLinkDatum<N>

/** 节点碰撞半径(约 ArtistPill 92px 宽度的一半 + 间隙),两节点中心距小于其 2 倍即视为重叠。 */
export const NODE_COLLIDE_RADIUS = 66
/** 选中节点的碰撞半径:选中态头像放大 + 发光描边,占位也要跟着变大,把邻居再推开一圈。 */
export const SELECTED_COLLIDE_RADIUS = 80
/** 父子连线的目标弹簧长度:新节点从父节点附近弹出后,最终稳定在这个距离左右。 */
export const LINK_DISTANCE = 185

export function createArtistGraphSimulation<N extends GraphSimNode>(
  nodes: N[],
  links: GraphSimLink<N>[]
): Simulation<N, GraphSimLink<N>> {
  return forceSimulation(nodes)
    // distanceMax 裁掉远距离的排斥计算——节点一多,charge 力的 Barnes-Hut 遍历是仿真里最贵的部分,
    // 而两个隔了大半张画布的节点本来也不需要互相推挤,裁掉之后既省算力又不影响观感。
    .force('charge', forceManyBody().strength(-24).distanceMax(320))
    // iterations 保持 2:调到 1 省了一点算力,但实测收敛不充分,密集处会留一点残余重叠
    // (Playwright 点击被相邻节点挡住)——不重叠是硬性要求,不能为了性能牺牲。
    .force('collide', forceCollide<N>(NODE_COLLIDE_RADIUS).strength(1).iterations(2))
    .force(
      'link',
      forceLink<N, GraphSimLink<N>>(links)
        .id((d) => d.id)
        .distance(LINK_DISTANCE)
        .strength(0.4)
    )
    // alphaDecay 调大(默认 0.0228→0.045):每次生长重新加热后能更快收敛停摆,不会拖几百帧,
    // 节点越滚越多时主线程不会被 tick 长期占用;但没有大到牺牲 collide 的收敛质量。
    .alphaDecay(0.045)
    .velocityDecay(0.5)
}

export function getLinkForce<N extends GraphSimNode>(
  sim: Simulation<N, GraphSimLink<N>>
): ForceLink<N, GraphSimLink<N>> {
  return sim.force('link') as ForceLink<N, GraphSimLink<N>>
}

/** 取碰撞力:选中态切换时重设 radius 访问器(d3 会重新初始化缓存的半径数组)并重新加热,让占位实时变化。 */
export function getCollideForce<N extends GraphSimNode>(
  sim: Simulation<N, GraphSimLink<N>>
): ForceCollide<N> {
  return sim.force('collide') as ForceCollide<N>
}

/** 新节点落在 parent 附近的小范围随机抖动位置,交给仿真自己用碰撞力把它们弹开——不用再手算角度/半径。 */
export function jitterNear(parent: { x?: number; y?: number }, spread = 16): { x: number; y: number } {
  return {
    x: (parent.x ?? 0) + (Math.random() - 0.5) * spread,
    y: (parent.y ?? 0) + (Math.random() - 0.5) * spread,
  }
}
