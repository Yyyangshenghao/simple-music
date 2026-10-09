import { usePlaylistStore } from '../stores/playlist'
import { useShuangeStore } from '../stores/shuange'

/** 外部上下首控制跟随当前播放模式，刷歌期间保留原队列。 */
export function stepPlayback(direction: 1 | -1): void {
  const shuange = useShuangeStore.getState()
  const controls = shuange.active ? shuange : usePlaylistStore.getState()
  if (direction === 1) void controls.next()
  else void controls.prev()
}
