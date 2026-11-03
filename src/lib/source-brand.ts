import type { MusicSource } from '../types/domain'

interface SourceBrand {
  label: string
  color: string
  colorSoft: string
}

/** 音源品牌色，用于头像光晕；取自官方品牌色（网易云 #D43C33 / QQ音乐 #0DAF52），与 tokens.css 的 ambient(取色于封面) 体系无关。 */
export const SOURCE_BRAND: Record<MusicSource, SourceBrand> = {
  netease: { label: '网易云', color: '#D43C33', colorSoft: 'rgba(212, 60, 51, 0.4)' },
  qq: { label: 'QQ音乐', color: '#0DAF52', colorSoft: 'rgba(13, 175, 82, 0.4)' },
  apple: { label: 'Apple Music', color: '#FA243C', colorSoft: 'rgba(250, 36, 60, 0.4)' },
  kugou: { label: '酷狗音乐', color: '#1E8CF5', colorSoft: 'rgba(30, 140, 245, 0.4)' }, bilibili: { label: '哔哩哔哩', color: '#FB7299', colorSoft: 'rgba(251, 114, 153, 0.4)' },
  qishui: { label: '汽水音乐', color: '#2FC7B4', colorSoft: 'rgba(47, 199, 180, 0.4)' },
  local: { label: '本地', color: '#8B8B8B', colorSoft: 'rgba(139, 139, 139, 0.4)' }
}
