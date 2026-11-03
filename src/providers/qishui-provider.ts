import { QishuiMusicService } from '../lib/qishui-music-service'
import { createLegacyProvider } from './legacy-provider-adapter'

export const qishuiProvider = createLegacyProvider({
  descriptor: {
    id: 'qishui',
    label: '汽水音乐',
    color: '#2FC7B4',
    colorSoft: 'rgba(47, 199, 180, 0.4)',
    iconKey: 'qishui',
    defaultEnabled: false,
  },
  service: new QishuiMusicService(),
  // 游客没有个性化推荐，也没有可用的公开推荐歌单接口。
  surfaces: [],
})
