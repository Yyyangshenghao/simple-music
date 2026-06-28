// 各预设的粒子初始分布生成器。返回 Float32Array(xyz*count)。

export type ShapeKind = 'sphere' | 'galaxy' | 'wave' | 'burst' | 'skull'

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function generateShape(kind: ShapeKind, count: number, radius = 6): Float32Array {
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const o = i * 3
    switch (kind) {
      case 'sphere': {
        // 均匀球面 + 少量径向抖动
        const u = Math.random()
        const v = Math.random()
        const theta = 2 * Math.PI * u
        const phi = Math.acos(2 * v - 1)
        const r = radius * (0.85 + Math.random() * 0.15)
        pos[o] = r * Math.sin(phi) * Math.cos(theta)
        pos[o + 1] = r * Math.sin(phi) * Math.sin(theta)
        pos[o + 2] = r * Math.cos(phi)
        break
      }
      case 'galaxy': {
        // 旋臂
        const arm = i % 3
        const t = Math.random()
        const ang = t * Math.PI * 4 + (arm * Math.PI * 2) / 3
        const r = t * radius
        pos[o] = Math.cos(ang) * r + rand(-0.4, 0.4)
        pos[o + 1] = rand(-0.6, 0.6) * (1 - t)
        pos[o + 2] = Math.sin(ang) * r + rand(-0.4, 0.4)
        break
      }
      case 'wave': {
        const gx = rand(-radius, radius)
        const gz = rand(-radius, radius)
        pos[o] = gx
        pos[o + 1] = Math.sin(gx * 0.5) * Math.cos(gz * 0.5)
        pos[o + 2] = gz
        break
      }
      case 'burst': {
        const dir = [rand(-1, 1), rand(-1, 1), rand(-1, 1)]
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
        const r = Math.pow(Math.random(), 0.5) * radius
        pos[o] = (dir[0] / len) * r
        pos[o + 1] = (dir[1] / len) * r
        pos[o + 2] = (dir[2] / len) * r
        break
      }
      case 'skull': {
        // 风格化「头骨」：上半球 + 两个眼窝空洞 + 下颌带
        const u = Math.random()
        const v = Math.random()
        const theta = 2 * Math.PI * u
        const phi = Math.acos(2 * v - 1)
        let x = Math.sin(phi) * Math.cos(theta)
        let y = Math.sin(phi) * Math.sin(theta)
        let z = Math.cos(phi)
        // 眼窝：剔除两个区域的点，改放到外缘
        const eye = (Math.abs(x - 0.35) < 0.22 || Math.abs(x + 0.35) < 0.22) && y > 0.1 && y < 0.5 && z > 0.6
        if (eye) {
          x *= 1.3
          z *= 0.4
        }
        pos[o] = x * radius * 0.9
        pos[o + 1] = y * radius * 1.05
        pos[o + 2] = z * radius * 0.9
        break
      }
      default: {
        pos[o] = rand(-radius, radius)
        pos[o + 1] = rand(-radius, radius)
        pos[o + 2] = rand(-radius, radius)
      }
    }
  }
  return pos
}
