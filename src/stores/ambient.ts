import { create } from 'zustand'
import { DEFAULT_PALETTE } from '../lib/extract-color'

export type AmbientPalette = [string, string, string]

interface AmbientStore {
  /** 氛围三色：主色/副色/点缀色，来自当前歌曲封面。 */
  palette: AmbientPalette
  /** 当前封面平均相对亮度(0-1),无封面/提取失败为 0;用于浅色封面下翻转歌词颜色。 */
  coverLuma: number
  setPalette(palette: AmbientPalette): void
  setCoverLuma(luma: number): void
  resetPalette(): void
}

export const useAmbientStore = create<AmbientStore>((set) => ({
  palette: [...DEFAULT_PALETTE],
  coverLuma: 0,

  setPalette(palette) {
    set({ palette })
  },

  setCoverLuma(luma) {
    set({ coverLuma: luma })
  },

  resetPalette() {
    set({ palette: [...DEFAULT_PALETTE] })
  }
}))
