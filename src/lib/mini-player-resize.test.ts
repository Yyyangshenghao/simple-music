import { describe, expect, it } from 'vitest'
import { beginMiniPlayerResize, updateMiniPlayerResize } from './mini-player-resize'

describe('迷你播放器缩放会话', () => {
  it('触及最小宽度后，反向拖动需先越过被裁掉的过拖距离', () => {
    let session = beginMiniPlayerResize(500, 360)

    let next = updateMiniPlayerResize(session, 340)
    session = next.session
    expect(next.delta).toBe(-60)

    next = updateMiniPlayerResize(session, 390)
    session = next.session
    expect(next.delta).toBe(0)

    next = updateMiniPlayerResize(session, 450)
    expect(next.delta).toBe(10)
  })

  it('最大宽度方向同样保留过拖距离', () => {
    let session = beginMiniPlayerResize(500, 700)

    let next = updateMiniPlayerResize(session, 700)
    session = next.session
    expect(next.delta).toBe(60)

    next = updateMiniPlayerResize(session, 650)
    session = next.session
    expect(next.delta).toBe(0)

    next = updateMiniPlayerResize(session, 550)
    expect(next.delta).toBe(-10)
  })
})
