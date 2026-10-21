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

export function createPopLyricTimeline(pops: HTMLElement[], glows: HTMLElement[], words: PopWord[], seed: number, scene?: { element: HTMLElement; reveal: PopReveal }) {
  const entries = words.map((word, index) => {
    const pose = wordPose(seed, index)
    const arrival = Math.max(1, word.popMs)
    const held = Math.max(arrival + 80, word.durationMs + POP_LEAD_MS)
    const duration = held + lyricPopTiming.settleMs
    const transform = (y: number, scale: number, angle: number) => `translate(${pose.x}em, ${y}em) scale(${scale}) rotate(${angle}deg)`
    const direction = index % 2 ? -1 : 1
    const peak = scene?.reveal === 'fold' ? lyricPopTiming.activeScale : lyricPopTiming.compactScale
    const entrance = scene?.reveal === 'sweep'
      ? `translate(${direction * 0.7}em, ${pose.y}em) scale(0.84) rotate(${-direction * 9}deg)`
      : scene?.reveal === 'fold'
        ? `perspective(600px) translateY(0.35em) rotateX(-65deg) scale(${lyricPopTiming.entryScale})`
        : transform(0.7, lyricPopTiming.entryScale, pose.angle + 14)
    const pop = pops[index].animate([
      { opacity: 0, transform: entrance, clipPath: scene?.reveal === 'sweep' ? `inset(0 ${direction > 0 ? '100%' : '0'} 0 ${direction < 0 ? '100%' : '0'})` : 'inset(-30%)', filter: 'blur(7px)', easing: lyricPopTiming.easing },
      { opacity: 1, transform: transform(pose.y - 0.08, peak, pose.angle * 0.3), clipPath: 'inset(-30%)', filter: 'blur(0px)', offset: arrival / duration },
      { opacity: 1, transform: transform(pose.y - 0.04, lyricPopTiming.heldScale, pose.angle * 0.3), clipPath: 'inset(-30%)', filter: 'blur(0px)', offset: held / duration, easing: lyricPopTiming.easing },
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
  const camera = scene?.element.animate([
    { transform: `translate(${lyricPopTiming.cameraShift}px, 3px) scale(0.985) rotate(-0.6deg)` },
    { transform: `translate(${-lyricPopTiming.cameraShift}px, -3px) scale(${lyricPopTiming.cameraScale}) rotate(0.6deg)` },
  ], { duration: sceneDuration, fill: 'both', easing: 'linear' })
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
