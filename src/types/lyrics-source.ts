import type { MusicSource, Track } from './domain'

export type LyricOrigin = MusicSource | 'amll' | 'kugou'
export type LyricSourcePreference = 'auto' | 'origin' | Exclude<LyricOrigin, 'local' | 'apple'>
export type LyricCandidateStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'mismatch' | 'error' | 'disabled' | 'login' | 'unavailable'

export interface LyricPreviewLine {
  time: number
  text: string
  translation?: string
  romaji?: string
}

export interface LyricSourceCandidate {
  origin: LyricOrigin
  status: LyricCandidateStatus
  message?: string
  preview: LyricPreviewLine[]
  wordTimed: boolean
  hasTranslation: boolean
  hasRomaji: boolean
  matchedName?: string
  matchedArtist?: string
  translationOrigin?: LyricOrigin
  romajiOrigin?: LyricOrigin
}

export interface RememberedLyricSource {
  origin: LyricOrigin
  name: string
  artist: string
  /** 仅保存录音匹配所需字段，不持久化播放 URL 或凭证。 */
  match?: Track
}

export const LYRIC_ORIGINS: readonly LyricOrigin[] = ['netease', 'qq', 'apple', 'local', 'amll', 'kugou']
export const LYRIC_SOURCE_LABELS: Record<LyricOrigin | 'auto' | 'origin', string> = {
  auto: '自动选择', origin: '歌曲原平台', netease: '网易云音乐', qq: 'QQ 音乐',
  apple: 'Apple Music', local: '本地歌词', amll: 'AMLL 逐字歌词库', kugou: '酷狗歌词库',
}

export interface LyricSourceActions {
  queryCandidates(trackKey: string, token: string, origin?: LyricOrigin): Promise<void>
  cancelSelection(token: string): void
  chooseSource(trackKey: string, token: string, origin: LyricOrigin | 'auto', remember: boolean): Promise<{ saved: boolean; offsetReset: boolean }>
}
