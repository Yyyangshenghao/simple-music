import { create } from 'zustand'
import { DEFAULT_PALETTE } from '../lib/extract-color'

export type AmbientPalette = [string, string, string]

interface AmbientStore {
  /** 氛围三色：主色/副色/点缀色，来自当前歌曲封面。 */
  palette: AmbientPalette
  setPalette(palette: AmbientPalette): void
  resetPalette(): void
}

export const useAmbientStore = create<AmbientStore>((set) => ({
  palette: [...DEFAULT_PALETTE],

  setPalette(palette) {
    set({ palette })
  },

  resetPalette() {
    set({ palette: [...DEFAULT_PALETTE] })
  }
}))
