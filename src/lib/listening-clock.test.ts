import { describe, expect, it } from 'vitest'
import { ListeningClock } from './listening-clock'

describe('有效收听计时', () => {
  it('暂停、缓冲和拖动进度不累计；恢复后只计实际前进', () => {
    const clock = new ListeningClock()
    clock.update(true, 60, 0)
    clock.sample(70, 10_000)
    clock.update(false, 70, 10_000)
    clock.rebase(150, 30_000)
    clock.update(true, 150, 40_000)
    clock.sample(155, 45_000)
    expect(clock.seconds).toBe(15)
  })

  it('不把断点位置、倍速媒体时长或未前进的等待算作真实收听', () => {
    const clock = new ListeningClock()
    clock.update(true, 120, 0, 2)
    clock.sample(140, 10_000)
    clock.sample(140, 30_000)
    clock.update(false, 140, 30_000)
    expect(clock.seconds).toBe(10)
    expect(clock.mediaSeconds).toBe(20)
  })

  it('媒体进度跳跃也不超过实际经过的时间；重复采样不重复累计', () => {
    const clock = new ListeningClock()
    clock.update(true, 0, 0)
    clock.sample(100, 1000)
    clock.sample(100, 1000)
    expect(clock.seconds).toBe(1)
    clock.rebase(0, 1000)
    clock.sample(3, 4000)
    expect(clock.seconds).toBe(4)
  })
})
