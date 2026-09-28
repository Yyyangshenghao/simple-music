import type { Lyrics3dStyle } from '../../types/domain'

/** 每种风格有独立的外观和空间布局，静音时也能区分。 */
export const LYRIC_STYLE_LOOKS = {
  glass: { glow: 0, particles: 0, panel: 0, depth: 0.18, stagger: 0 },
  smooth: { glow: 0, particles: 0, panel: 0, depth: 0, stagger: 0 },
  float: { glow: 0.65, particles: 1, panel: 0, depth: 0.65, stagger: 0.34 },
  quick: { glow: 0, particles: 0, panel: 2, depth: 0, stagger: 0 },
  shine: { glow: 1.35, particles: 0.45, panel: 0, depth: 0.12, stagger: 0 },
  glitch: { glow: 0.12, particles: 0, panel: 0, depth: 0.08, stagger: 0 },
  focus: { glow: 0, particles: 0, panel: 0, depth: 0, stagger: 0 }
} as const

/** 不改变歌词时钟与 KTV 进度；入场和周期效果均服从动效强度。 */
export function lyricStyleFrame(
  style: Lyrics3dStyle,
  age: number,
  enterDuration: number,
  time: number,
  beat: number,
  intensity: number,
  playing = true
) {
  const motion = Math.max(0, Math.min(2, intensity))
  const entry = Math.max(0, 1 - age / Math.max(0.1, enterDuration)) ** 2
  // MusicKit 等播放通道没有频谱数据，用短暂的周期错位保留故障风格。
  const cycle = ((time % 3.2) + 3.2) % 3.2
  const burst = cycle > 2.7 && cycle < 3 ? Math.sin((cycle - 2.7) / 0.3 * Math.PI) : 0
  const pulse = playing ? Math.max(Math.max(0, Math.min(1, beat)), burst, entry) * motion : 0
  const sweep = style === 'shine' || style === 'glass'
    ? ((time * (style === 'shine' ? 0.38 : 0.12)) % 1) * 1.6 - 0.3
    : -1
  return {
    sweep,
    sheen: (style === 'shine' ? 1.1 : style === 'glass' ? 0.6 : 0) * Math.min(1, motion),
    prism: style === 'glitch' ? 0.004 * motion : 0,
    glitch: style === 'glitch' ? pulse * 0.024 : 0,
    tiltX: (style === 'glass' ? entry * 0.18 : style === 'float' ? Math.sin(time * 0.48) * 0.14 : 0) * motion,
    tiltY: (style === 'float' ? Math.sin(time * 0.65) * 0.28 : 0) * motion,
    slideX: style === 'quick' ? entry * 1.3 * motion : 0
  }
}
