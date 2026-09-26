import { AppleMusicService, appleMusicTrackUrl } from '../lib/apple-music-service'
import { createLegacyProvider } from './legacy-provider-adapter'

const service = new AppleMusicService()
const quality = { id: 'standard', label: 'Apple Music', rank: 0 }

export const appleMusicProvider = createLegacyProvider({
  descriptor: {
    id: 'apple', label: 'Apple Music', color: '#FA243C',
    colorSoft: 'rgba(250, 36, 60, 0.4)', iconKey: 'apple', defaultEnabled: false,
  },
  service,
  surfaces: [{
    id: 'apple:playlist-feed', source: 'apple', kind: 'playlist-feed',
    title: 'Apple Music 热门歌单', presentation: 'stack', refresh: 'session', auth: 'none',
  }],
})

appleMusicProvider.playback = {
  async getQualities() { return [quality] },
  async resolve(track, _quality, signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return [{ source: 'apple', track, quality, url: appleMusicTrackUrl(track), trial: false }]
  },
  getLyrics: () => service.getLyrics(),
}
