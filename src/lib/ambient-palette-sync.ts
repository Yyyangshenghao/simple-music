import { usePlayerStore } from '../stores/player'
import { useAmbientStore } from '../stores/ambient'
import { useNavigationStore } from '../stores/navigation'
import { useGameModeStore } from '../stores/game-mode'
import { api } from './api'
import { extractPalette, extractLuma, DEFAULT_PALETTE } from './extract-color'
import { sizedImage, CANVAS_COVER_PX } from './image-size'

let stopAmbientPaletteSync: (() => void) | undefined

/** 宿主持有封面取色；根节点颜色补间仍由界面负责。 */
export function initAmbientPaletteSync(): () => void {
  if (stopAmbientPaletteSync) return stopAmbientPaletteSync
  if (typeof Image === 'undefined') return () => {}
  let stopped = false
  let image: HTMLImageElement | undefined
  let previousCover: string | undefined
  let previousSuspended: boolean | undefined
  const cancelImage = () => {
    if (!image) return
    image.onload = null
    image.onerror = null
    image.src = ''
    image = undefined
  }
  const reset = () => {
    useAmbientStore.getState().setPalette([...DEFAULT_PALETTE])
    useAmbientStore.getState().setCoverLuma(0)
  }
  const sync = () => {
    if (stopped) return
    const cover = usePlayerStore.getState().currentTrack?.cover
    // 刷歌卡片自身营造背景，沿用暂停取色的规则；普通切页不重新取图。
    const suspended = useGameModeStore.getState().enabled || useNavigationStore.getState().currentView === 'shuange'
    if (cover === previousCover && suspended === previousSuspended) return
    previousCover = cover
    previousSuspended = suspended
    cancelImage()
    if (suspended) return
    if (!cover) {
      reset()
      return
    }
    const currentImage = new Image()
    image = currentImage
    currentImage.crossOrigin = 'anonymous'
    currentImage.onload = () => {
      if (stopped || image !== currentImage) return
      useAmbientStore.getState().setPalette(extractPalette(currentImage))
      useAmbientStore.getState().setCoverLuma(extractLuma(currentImage))
    }
    currentImage.onerror = () => {
      if (!stopped && image === currentImage) reset()
    }
    currentImage.src = api.coverImage(sizedImage(cover, CANVAS_COVER_PX))
  }
  const stopPlayer = usePlayerStore.subscribe((state, previous) => {
    if (state.currentTrack?.cover !== previous.currentTrack?.cover) sync()
  })
  const stopNavigation = useNavigationStore.subscribe((state, previous) => {
    if ((state.currentView === 'shuange') !== (previous.currentView === 'shuange')) sync()
  })
  const stopGame = useGameModeStore.subscribe((state, previous) => {
    if (state.enabled !== previous.enabled) sync()
  })
  sync()
  stopAmbientPaletteSync = () => {
    if (stopped) return
    stopped = true
    cancelImage()
    stopPlayer()
    stopNavigation()
    stopGame()
    stopAmbientPaletteSync = undefined
  }
  return stopAmbientPaletteSync
}
