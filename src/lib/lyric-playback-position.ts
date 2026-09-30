import type { usePlayerStore } from '../stores/player'

type LyricPlaybackState = Pick<ReturnType<typeof usePlayerStore.getState>, 'currentTrack' | 'playbackTransport' | 'position'> & {
  _lyricPosition?(): number
  _engine(): { position: number }
}

export function lyricPlaybackPosition(player: LyricPlaybackState): number {
  // MusicKit 不经过本地音频引擎；包含加载期间等待执行的拖动位置。
  if (player.playbackTransport === 'musickit'
    || (player.playbackTransport === null && player.currentTrack?.source === 'apple')) {
    return player._lyricPosition?.() ?? player.position
  }
  return player._engine().position
}
