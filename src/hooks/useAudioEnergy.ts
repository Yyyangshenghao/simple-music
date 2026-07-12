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
    let raf = 0
    let energy = 0
    const tick = () => {
      const data = usePlayerStore.getState()._engine().getFrequencyData()
      energy = smoothEnergy(energy, bassEnergyFrom(data))
      el.style.setProperty('--audio-energy', energy.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el.style.setProperty('--audio-energy', '0')
    }
  }, [ref, playing, eco])
}
