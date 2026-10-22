import { lyricPopTiming } from './motion-presets'
import { POP_LEAD_MS, type PopWord } from './pop-lyric-timing'
import type { PopReveal } from './pop-lyric-layout'

/** 每首每句使用固定姿态，拖回同一句仍保持相同排版，播放时只移动动画时钟。 */
function wordPose(seed: number, index: number): { x: number; y: number; angle: number } {
  let value = Math.imul((Math.round(seed) ^ Math.imul(index + 1, 2654435761)) >>> 0, 2246822519) >>> 0
  const sample = () => {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    return (value >>> 0) / 0xffffffff - 0.5
  }
  return { x: sample() * 0.06, y: sample() * 0.12, angle: sample() * 9 }
}

/**
 * 用户可调的跃字参数：intensity 按比例放大或收敛入场位移、缩放与倾角（1 为默认幅度），
 * camera 关闭时整句不做推移，只保留逐字动画。
 */
export interface PopMotionTuning {
  intensity?: number
  camera?: boolean
}

export function createPopLyricTimeline(pops: HTMLElement[], glows: HTMLElement[], words: PopWord[], seed: number, scene?: { element: HTMLElement; reveal: PopReveal } & PopMotionTuning) {
  const k = Math.min(1.6, Math.max(0.4, scene?.intensity ?? 1))
  // 缩放类参数按与 1 的差值放大，保证 intensity=1 时与原设计逐值一致。
  const amp = (value: number) => 1 + (value - 1) * k
  const entries = words.map((word, index) => {
    const base = wordPose(seed, index)
    const pose = { x: base.x * k, y: base.y * k, angle: base.angle * k }
    const arrival = Math.max(1, word.popMs)
    const held = Math.max(arrival + 80, word.durationMs + POP_LEAD_MS)
    const duration = held + lyricPopTiming.settleMs
    const transform = (y: number, scale: number, angle: number) => `translate(${pose.x}em, ${y}em) scale(${scale}) rotate(${angle}deg)`
    const direction = index % 2 ? -1 : 1
    const peak = amp(scene?.reveal === 'fold' ? lyricPopTiming.activeScale : lyricPopTiming.compactScale)
    const entrance = scene?.reveal === 'sweep'
      ? `translate(${direction * 0.7 * k}em, ${pose.y}em) scale(${amp(0.84)}) rotate(${-direction * 9 * k}deg)`
      : scene?.reveal === 'fold'
        ? `perspective(600px) translateY(${0.35 * k}em) rotateX(${-65 * k}deg) scale(${amp(lyricPopTiming.entryScale)})`
        : transform(0.7 * k, amp(lyricPopTiming.entryScale), pose.angle + 14 * k)
    const pop = pops[index].animate([
      { opacity: 0, transform: entrance, clipPath: scene?.reveal === 'sweep' ? `inset(0 ${direction > 0 ? '100%' : '0'} 0 ${direction < 0 ? '100%' : '0'})` : 'inset(-30%)', filter: 'blur(7px)', easing: lyricPopTiming.easing },
      { opacity: 1, transform: transform(pose.y - 0.08, peak, pose.angle * 0.3), clipPath: 'inset(-30%)', filter: 'blur(0px)', offset: arrival / duration },
      { opacity: 1, transform: transform(pose.y - 0.04, amp(lyricPopTiming.heldScale), pose.angle * 0.3), clipPath: 'inset(-30%)', filter: 'blur(0px)', offset: held / duration, easing: lyricPopTiming.easing },
      { opacity: 1, transform: transform(pose.y, 1, pose.angle), clipPath: 'inset(-30%)', filter: 'blur(0px)' },
    ], { duration, fill: 'both', easing: 'linear' })
    const glowDuration = Math.max(1, word.durationMs) + lyricPopTiming.glowHoldMs
    const glow = glows[index].animate([
      { opacity: 1 },
      { opacity: 1, offset: Math.max(1, word.durationMs) / glowDuration, easing: 'ease-out' },
      { opacity: 0 },
    ], { duration: glowDuration, fill: 'both', easing: 'linear' })
    pop.pause()
    glow.pause()
    return { word, pop, duration, glow, glowDuration }
  })
  const sceneDuration = Math.max(1200, ...words.map(word => word.startMs + word.durationMs))
  const shift = lyricPopTiming.cameraShift * k
  const camera = scene && scene.camera !== false ? scene.element.animate([
    { transform: `translate(${shift}px, ${3 * k}px) scale(${amp(0.985)}) rotate(${-0.6 * k}deg)` },
    { transform: `translate(${-shift}px, ${-3 * k}px) scale(${amp(lyricPopTiming.cameraScale)}) rotate(${0.6 * k}deg)` },
  ], { duration: sceneDuration, fill: 'both', easing: 'linear' }) : undefined
  camera?.pause()
  return {
    seek(elapsed: number) {
      if (!Number.isFinite(elapsed)) return
      if (camera) camera.currentTime = Math.min(sceneDuration, Math.max(0, elapsed))
      for (const entry of entries) {
        const popAt = Math.min(entry.duration, Math.max(0, elapsed - entry.word.startMs + POP_LEAD_MS))
        const glowAt = Math.min(entry.glowDuration, Math.max(0, elapsed - entry.word.startMs))
        if (entry.pop.currentTime !== popAt) entry.pop.currentTime = popAt
        if (entry.glow.currentTime !== glowAt) entry.glow.currentTime = glowAt
      }
    },
    dispose() {
      camera?.cancel()
      entries.forEach(({ pop, glow }) => { pop.cancel(); glow.cancel() })
    },
  }
}
