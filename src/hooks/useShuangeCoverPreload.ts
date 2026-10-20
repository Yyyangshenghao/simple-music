import { useEffect } from 'react'
import { SHUANGE_COVER_PX, useShuangeStore } from '../stores/shuange'
import { preloadTracks, releasePreloadWindow } from '../lib/track-preload'

/**
 * 可见界面只预热宿主给出的封面窗口 不重复解析歌词或播放地址
 *
 * @param enabled 主窗口可见且未进入游戏模式
 */
export function useShuangeCoverPreload(enabled: boolean): void {
  const tracks = useShuangeStore(state => state.preloadWindow)
  useEffect(() => {
    if (enabled) preloadTracks(tracks, 'standard', null, { owner: 'shuange', coverPx: SHUANGE_COVER_PX, deferUrls: true })
    else releasePreloadWindow('shuange')
  }, [enabled, tracks])
  useEffect(() => () => releasePreloadWindow('shuange'), [])
}
