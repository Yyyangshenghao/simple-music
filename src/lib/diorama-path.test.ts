import { describe, it, expect } from 'vitest'
import { cameraAt, fitDistance, lineYaw, pathPoint, revealFraction, rippleState, shotKind, shotPose } from './diorama-path'

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe('镜台路径与取景', () => {
  it('长句时镜头退到能看全整句，短句仍按远近设置', () => {
    const need = fitDistance(12, 50, 1.6)
    expect(12 / 2 / (need * Math.tan(25 * Math.PI / 180) * 1.6)).toBeCloseTo(0.88)
    for (let i = 0; i < 8; i++) {
      const pose = shotPose(i, 4, 0.5, 0.6, need)
      expect(dist(pose.position, pose.target)).toBeGreaterThan(need * 0.85)
    }
    const short = shotPose(2, 4, 0.5, 1, 0)
    expect(dist(short.position, short.target)).toBeLessThan(need)
    expect(cameraAt(3, 5, 6, 4, 1, true, () => need)).toEqual(shotPose(3, 4, 5 / 6, 1, need))
  })

  it('上一句很短、镜头还没飞完就换句：从镜头实际所在起飞，不跳', () => {
    const fit = () => 0
    const lineSec = () => 0.8
    const before = cameraAt(4, 0.8, 1, 4, 1, true, fit, lineSec)
    const after = cameraAt(5, 0, 3, 4, 1, true, fit, lineSec)
    expect(dist(after.position, before.position)).toBeCloseTo(0)
    expect(dist(after.target, before.target)).toBeCloseTo(0)
  })

  it('路径一路向远处延伸，结果固定', () => {
    expect(pathPoint(3, 7)[2]).toBeLessThan(pathPoint(2, 7)[2])
    expect(pathPoint(3, 7)).toEqual(pathPoint(3, 7))
    expect(Number.isFinite(lineYaw(0, 7))).toBe(true)
  })

  it('相邻句取景不同；镜头在面板正面一侧且离面板有距离', () => {
    for (let i = 1; i < 30; i++) expect(shotKind(i, 4)).not.toBe(shotKind(i - 1, 4))
    for (let i = 0; i < 20; i++) {
      const pose = shotPose(i, 4, 0.5)
      const yaw = lineYaw(i, 4)
      const here = pathPoint(i, 4)
      const toCamera = [pose.position[0] - here[0], pose.position[2] - here[2]]
      expect(toCamera[0] * Math.sin(yaw) + toCamera[1] * Math.cos(yaw)).toBeGreaterThan(2)
      expect(dist(pose.position, pose.target)).toBeGreaterThan(3)
    }
  })

  it('换句时从上一句的取景飞过去，1.4 秒后到位；静态模式直接到位', () => {
    const start = cameraAt(5, 0, 4, 2, 1, true)
    const from = shotPose(4, 2, 1)
    expect(dist(start.position, from.position)).toBeLessThan(1e-6)
    const mid = cameraAt(5, 0.7, 4, 2, 1, true)
    expect(dist(mid.position, from.position)).toBeGreaterThan(0.1)
    const done = cameraAt(5, 1.5, 4, 2, 1, true)
    expect(dist(done.position, shotPose(5, 2, 1.5 / 4).position)).toBeLessThan(1e-6)
    expect(cameraAt(5, 0, 4, 2, 1, false)).toEqual(shotPose(5, 2, 0.4))
    expect(cameraAt(-1, 3, 4, 2, 1, true)).toEqual(shotPose(0, 2, 0.75))
  })

  it('有逐句时长时提前起飞，跨换句逐帧连续、无跳变，落位后回正', () => {
    const starts = [0, 4, 7.5, 8.3, 12, 16]
    const lineSec = (i: number) => (starts[i + 1] ?? 0) - starts[i]
    const fit = () => 0
    const poseAtTime = (t: number) => {
      let i = 0
      while (i + 1 < starts.length && starts[i + 1] <= t) i++
      return cameraAt(i, t - starts[i], Math.max(1, lineSec(i)), 4, 1, true, fit, lineSec)
    }
    // 换句前 0.3 秒镜头已经离开上一句的取景。
    expect(dist(poseAtTime(3.7).position, shotPose(0, 4, 3.7 / 4).position)).toBeGreaterThan(0.01)
    // 60fps 采样：相邻帧位移与视线变化都很小（含 0.8 秒的短句）。
    let maxStep = 0
    let maxLook = 0
    let prev = poseAtTime(0)
    for (let t = 1 / 60; t < 15; t += 1 / 60) {
      const pose = poseAtTime(t)
      maxStep = Math.max(maxStep, dist(pose.position, prev.position))
      maxLook = Math.max(maxLook, dist(pose.target, prev.target))
      prev = pose
    }
    expect(maxStep).toBeLessThan(0.45)
    expect(maxLook).toBeLessThan(0.45)
    expect(poseAtTime(14).roll ?? 0).toBe(0)
  })

  it('逐字揭示按字的右缘插值；涟漪扩散后消失', () => {
    const edges = [0.2, 0.5, 1]
    expect(revealFraction(edges, 0)).toBe(0)
    expect(revealFraction(edges, 1)).toBeCloseTo(0.2)
    expect(revealFraction(edges, 1.5)).toBeCloseTo(0.35)
    expect(revealFraction(edges, 9)).toBe(1)
    expect(rippleState(-0.1)).toBeNull()
    expect(rippleState(0.1)!.opacity).toBeGreaterThan(rippleState(1)!.opacity)
    expect(rippleState(2)).toBeNull()
  })
})
