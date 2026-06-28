import { presetById } from './presets'
import { useVisualStore } from '../../stores/visual'

/**
 * 头骨预设的语义包装：当 fx 选中头骨预设(id 4)时返回 true，
 * 供上层判断是否启用专属相机/光效（粒子分布本身由 ParticleCloud 按预设 shape 生成）。
 */
export function useIsSkullPreset(): boolean {
  const preset = useVisualStore((s) => s.preset)
  return presetById(preset).shape === 'skull'
}
