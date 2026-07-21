import { describe, it, expect } from 'vitest'
import {
  createArtistGraphSimulation,
  getLinkForce,
  NODE_COLLIDE_RADIUS,
  LINK_DISTANCE,
  type GraphSimNode,
  type GraphSimLink,
} from './artist-graph-sim'

function settle<N extends GraphSimNode>(nodes: N[], links: GraphSimLink<N>[], ticks = 300) {
  const sim = createArtistGraphSimulation(nodes, links)
  sim.stop() // 不用内部计时器,手动 tick 保证测试确定性
  for (let i = 0; i < ticks; i++) sim.tick()
  return sim
}

describe('createArtistGraphSimulation', () => {
  it('大量节点从同一点出发,多轮 tick 后两两间距不小于碰撞直径(不重叠)', () => {
    const nodes: GraphSimNode[] = Array.from({ length: 20 }, (_, i) => ({ id: String(i), x: 0, y: 0 }))
    settle(nodes, [])
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x! - nodes[j].x!, nodes[i].y! - nodes[j].y!)
        expect(d).toBeGreaterThanOrEqual(NODE_COLLIDE_RADIUS * 2 - 5) // 留一点数值收敛误差
      }
    }
  })

  it('link 力把子节点拉在父节点附近,既不重叠也不会飘远', () => {
    const parent: GraphSimNode = { id: 'p', x: 0, y: 0 }
    const child: GraphSimNode = { id: 'c', x: 5, y: 5 }
    settle([parent, child], [{ source: 'p', target: 'c' }])
    const d = Math.hypot(parent.x! - child.x!, parent.y! - child.y!)
    expect(d).toBeGreaterThanOrEqual(NODE_COLLIDE_RADIUS * 2 - 5)
    expect(d).toBeLessThan(LINK_DISTANCE + 40)
  })

  it('新增节点+连线后重新 tick,新节点会被弹开且不与已有节点重叠', () => {
    const nodes: GraphSimNode[] = Array.from({ length: 6 }, (_, i) => ({ id: `seed${i}`, x: 0, y: 0 }))
    const sim = settle(nodes, [], 200)
    const parent = nodes[0]
    const children: GraphSimNode[] = Array.from({ length: 5 }, (_, i) => ({
      id: `child${i}`,
      x: parent.x! + i, // 都挤在父节点附近出发
      y: parent.y!,
    }))
    const allNodes = [...nodes, ...children]
    const links: GraphSimLink<GraphSimNode>[] = children.map((c) => ({ source: parent.id, target: c.id }))
    sim.nodes(allNodes)
    getLinkForce(sim).links(links)
    for (let i = 0; i < 300; i++) sim.tick()
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const d = Math.hypot(allNodes[i].x! - allNodes[j].x!, allNodes[i].y! - allNodes[j].y!)
        expect(d).toBeGreaterThanOrEqual(NODE_COLLIDE_RADIUS * 2 - 5)
      }
    }
  })
})
