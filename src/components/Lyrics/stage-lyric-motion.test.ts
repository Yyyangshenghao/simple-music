import { describe, expect, it } from 'vitest'
import { LYRIC_STYLE_LOOKS, lyricStyleFrame } from './stage-lyric-motion'
import type { Lyrics3dStyle } from '../../types/domain'

describe('lyricStyleFrame', () => {
  it('玻璃保持清晰字面，入场后不残留色差和侧倾', () => {
    const frame = lyricStyleFrame('glass', 2, 0.5, 4, 1, 1)
    expect(frame.prism).toBe(0)
    expect(frame.tiltX).toBe(0)
    expect(frame.tiltY).toBe(0)
    expect(LYRIC_STYLE_LOOKS.glass.particles).toBe(0)
    expect(LYRIC_STYLE_LOOKS.glass.panel).toBe(0)
    expect(LYRIC_STYLE_LOOKS.glass.glow).toBe(0)
  })
  it('故障切片响应节拍，普通时段回到清晰文字', () => {
    expect(lyricStyleFrame('glitch', 1, 0.5, 4, 1, 1).glitch).toBeGreaterThan(0)
    expect(lyricStyleFrame('glitch', 1, 0.5, 4, 0, 1).glitch).toBe(0)
    expect(lyricStyleFrame('smooth', 1, 0.5, 4, 1, 1).glitch).toBe(0)
  })

  it('没有频谱时仍有短促故障效果，周期结束后恢复', () => {
    expect(lyricStyleFrame('glitch', 5, 0.5, 2.85, 0, 1).glitch).toBeGreaterThan(0.015)
    expect(lyricStyleFrame('glitch', 5, 0.5, 3.1, 0, 1).glitch).toBe(0)
  })

  it('在故障周期中点暂停会清除切片，不将错位冻结在歌词上', () => {
    expect(lyricStyleFrame('glitch', 5, 0.5, 2.85, 1, 1, false).glitch).toBe(0)
  })

  it('丝滑和快切不带粒子和辉光，玻璃与快切使用不同装饰', () => {
    for (const style of ['smooth', 'quick'] as const) {
      expect(LYRIC_STYLE_LOOKS[style].particles).toBe(0)
      expect(LYRIC_STYLE_LOOKS[style].glow).toBe(0)
    }
    expect(LYRIC_STYLE_LOOKS.glass.panel).not.toBe(LYRIC_STYLE_LOOKS.quick.panel)
    expect(LYRIC_STYLE_LOOKS.float.depth).toBeGreaterThan(LYRIC_STYLE_LOOKS.smooth.depth)
  })

  it('入场倾斜与快切横移收敛到零，不累积位置偏移', () => {
    expect(lyricStyleFrame('glass', 0, 0.5, 0, 0, 1).tiltX).toBeGreaterThan(0)
    expect(lyricStyleFrame('glass', 0.5, 0.5, 0, 0, 1).tiltX).toBe(0)
    expect(lyricStyleFrame('quick', 0, 0.5, 0, 0, 1).slideX).toBeGreaterThan(0)
    expect(lyricStyleFrame('quick', 10, 0.5, 0, 0, 1).slideX).toBe(0)
  })

  it.each<Lyrics3dStyle>(['glass', 'smooth', 'float', 'quick', 'shine', 'glitch', 'focus'])(
    '%s 在零动效强度下关闭装饰运动', (style) => {
      const frame = lyricStyleFrame(style, 0, 0, 4, 1, 0)
      expect([frame.sheen, frame.prism, frame.glitch, frame.tiltX, frame.tiltY, frame.slideX].every(value => value === 0)).toBe(true)
    }
  )
})
