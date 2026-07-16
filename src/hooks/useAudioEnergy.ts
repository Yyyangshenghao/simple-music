import { useEffect } from 'react'
import type { RefObject } from 'react'
import { usePlayerStore } from '../stores/player'
import { useVisualStore } from '../stores/visual'
import { bassEnergyFrom, smoothEnergy } from '../lib/audio-energy'

/**
 * 播放中每帧读取频谱低频能量，平滑后写入目标元素的 --audio-energy（0–1）。
 * 暂停/eco 档时停表并归零，空闲零开销。
 */
export function useAudioEnergy(ref: RefObject<HTMLElement | null>): void {
  const playing = usePlayerStore((s) => s.status === 'playing')
  const eco = useVisualStore((s) => s.performanceMode === 'eco')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!playing || eco) {
      // 渐熄:按帧衰减到 0(约 0.35s),替代 CSS transition——每帧改值的注册属性
      // 挂 transition 会每帧催生新过渡对象,导致播放期间内存持续增长
      let raf = 0
      let v = parseFloat(el.style.getPropertyValue('--audio-energy')) || 0
      const decay = () => {
        v *= 0.86
        if (v < 0.01) {
          el.style.setProperty('--audio-energy', '0')
          return
        }
        el.style.setProperty('--audio-energy', v.toFixed(3))
        raf = requestAnimationFrame(decay)
      }
      raf = requestAnimationFrame(decay)
      return () => cancelAnimationFrame(raf)
    }
    // 辉光是低频模糊效果,30fps 足够;每帧做频谱拷贝+样式写入在 120Hz 屏上纯属浪费。
    // backgroundThrottling 全局关闭,窗口隐藏时 rAF 照跑,故 document.hidden 时跳过工作。
    const FRAME_MS = 1000 / 30
    let raf = 0
    let energy = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < FRAME_MS - 1 || document.hidden) return
      last = now
      const data = usePlayerStore.getState()._engine().getFrequencyData()
      energy = smoothEnergy(energy, bassEnergyFrom(data))
      el.style.setProperty('--audio-energy', energy.toFixed(3))
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el.style.setProperty('--audio-energy', '0')
    }
  }, [ref, playing, eco])
}
