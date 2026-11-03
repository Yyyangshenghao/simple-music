import { KugouMusicService } from '../lib/kugou-music-service'
import { createLegacyProvider } from './legacy-provider-adapter'

export const kugouProvider = createLegacyProvider({
  descriptor: {
    id: 'kugou',
    label: '酷狗音乐',
    color: '#1E8CF5',
    colorSoft: 'rgba(30, 140, 245, 0.4)',
    iconKey: 'kugou',
    defaultEnabled: false,
  },
  service: new KugouMusicService(),
  surfaces: [
    {
      id: 'kugou:playlist-feed',
      source: 'kugou',
      kind: 'playlist-feed',
      title: '酷狗推荐歌单',
      presentation: 'stack',
      refresh: 'paged',
      auth: 'none',
    },
  ],
})
