import { describe, expect, it } from 'vitest'
import { fitShotPose, normalizeShotText, planStoryboardShots, SHOT_POSES, shotPanDirection, storyboardDolly } from './stage-lyric-shots'

const lines = (texts: string[]) => texts.map((text) => ({ text }))

describe('planStoryboardShots', () => {
  it('同一首歌每次分配结果一致，相邻两句构图不同', () => {
    const song = lines(['第一句测试', '第二句测试', '第三句测试', '第四句测试', '第五句测试', '第六句测试', '第七句测试'])
    const a = planStoryboardShots(song)
    expect(planStoryboardShots(song)).toEqual(a)
    for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1])
  })

  it('重复出现的句子沿用第一次的构图，忽略标点空白', () => {
    const shots = planStoryboardShots(lines(['重复的句子', '中间一句', '另一句', '重复的句子！', '收尾']))
    expect(shots[3]).toBe(shots[0])
  })

  it('紧挨着的重复句仍换构图', () => {
    const shots = planStoryboardShots(lines(['同一句', '同一句']))
    expect(shots[1]).not.toBe(shots[0])
  })

  it('空输入返回空', () => {
    expect(planStoryboardShots([])).toEqual([])
  })
})

describe('镜头姿态', () => {
  it('横移与放大只用画面里剩下的空间', () => {
    // 短句：余量充足，保留完整构图
    expect(fitShotPose(SHOT_POSES['left-third'], 2, 10).x).toBeCloseTo(-1.7)
    expect(fitShotPose(SHOT_POSES['close-up'], 2, 10).scale).toBeCloseTo(1.32)
    // 接近满宽：横移只用两侧余量的一半（可用 9 − 文字 9×0.94），特写不撑出画面
    const long = fitShotPose(SHOT_POSES['right-third'], 9, 10)
    expect(long.x).toBeCloseTo((9 - 9 * 0.94) / 2)
    expect(long.x).toBeLessThan(SHOT_POSES['right-third'].x / 4)
    const closeUp = fitShotPose(SHOT_POSES['close-up'], 8, 10)
    expect(closeUp.scale * 8).toBeLessThanOrEqual(9 + 1e-9)
    // 远景缩小不受限制
    expect(fitShotPose(SHOT_POSES.wide, 9, 10).scale).toBe(SHOT_POSES.wide.scale)
  })

  it('接力方向与镜头位移相反；同列时按行号交替', () => {
    expect(shotPanDirection(SHOT_POSES['left-third'], SHOT_POSES['right-third'], 1)).toBe(-1)
    expect(shotPanDirection(SHOT_POSES['right-third'], SHOT_POSES['left-third'], 1)).toBe(1)
    expect(shotPanDirection(SHOT_POSES['close-up'], SHOT_POSES.wide, 2)).toBe(1)
    expect(shotPanDirection(SHOT_POSES['close-up'], SHOT_POSES.wide, 3)).toBe(-1)
  })

  it('慢推只在正常句里发生，随时间单调增加且有上限', () => {
    expect(storyboardDolly(1, 0.8)).toBe(0)
    expect(storyboardDolly(0, 4)).toBe(0)
    const early = storyboardDolly(1, 4)
    const late = storyboardDolly(4, 4)
    expect(late).toBeGreaterThan(early)
    expect(storyboardDolly(100, 100)).toBeLessThanOrEqual(0.08)
  })

  it('重复句判定忽略大小写与标点', () => {
    expect(normalizeShotText('Hello, World!')).toBe(normalizeShotText('hello world'))
  })
})
