import type { MusicSource, Track } from './domain'

export type LyricOrigin = MusicSource | 'amll' | 'kugou'
export const LYRIC_PRIORITY_SOURCES = ['netease', 'qq', 'amll', 'kugou'] as const
export type LyricPrioritySource = typeof LYRIC_PRIORITY_SOURCES[number]
export interface LyricSourceHealth { failures: number; suspended: boolean }
export interface LyricSourceProbe { status: 'loading' | LyricCandidateStatus; ms?: number; message?: string; sample: string }

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
  testSource(origin: LyricPrioritySource, sample: string): Promise<void>
  queryCandidates(trackKey: string, token: string, origin?: LyricOrigin): Promise<void>
  cancelSelection(token: string): void
  chooseSource(trackKey: string, token: string, origin: LyricOrigin | 'auto', remember: boolean): Promise<{ saved: boolean; offsetReset: boolean }>
}

// 网易公开歌曲详情校验的录音信息；QQ 仍通过同曲/版本/时长匹配，测试不触碰播放器。
export const LYRICS_TEST_SONGS = [
  { key: 'sunny', name: '晴天', artist: '周杰伦', id: '186016', duration: 269000 },
  { key: 'ocean', name: '海阔天空', artist: 'Beyond', id: '347230', duration: 326000 },
] as const
