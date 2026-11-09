import type { Track } from '../types/domain'
import type { SongComment, SongCommentsPage } from '../types/song-comments'
import { api, type QueryParams } from './api'
import { qqLyricIdentifiers } from './qq-lyric-identifiers'
import { resolvePending } from './queue-details'
import { providerAccountSession } from './provider-account-session'
import { useProviderStore } from '../stores/providers'

export function supportsSongComments(track: Track): boolean {
  return track.source === 'netease' || track.source === 'qq'
}

export function songCommentKey(comment: SongComment): string {
  const id = String(comment.id ?? '')
  return id || `${String(comment.user?.id ?? '')}:${comment.time}:${comment.content}`
}

export function mergeSongCommentsPage(current: SongCommentsPage, incoming: SongCommentsPage): SongCommentsPage {
  const known = new Set(current.comments.map(songCommentKey))
  const comments = [...current.comments]
  for (const comment of incoming.comments) {
    const key = songCommentKey(comment)
    if (known.has(key)) continue
    known.add(key)
    comments.push(comment)
  }
  return {
    comments,
    hotComments: current.hotComments,
    total: incoming.total ?? current.total,
    nextOffset: comments.length > current.comments.length ? incoming.nextOffset : undefined,
  }
}

export async function loadSongComments(track: Track, { offset = 0, signal }: { offset?: number; signal?: AbortSignal } = {}): Promise<SongCommentsPage> {
  if (!supportsSongComments(track)) throw new Error('这个来源暂不提供歌曲评论')
  const source = track.source as 'netease' | 'qq'
  const runtime = useProviderStore.getState().byId[source]
  const session = providerAccountSession(source)
  const checkCurrent = () => {
    signal?.throwIfAborted()
    if (useProviderStore.getState().byId[source] !== runtime || providerAccountSession(source) !== session) {
      throw new DOMException('评论读取会话已变化', 'AbortError')
    }
  }
  if (!runtime.enabled || runtime.auth !== 'authenticated') throw new Error('请登录并启用歌曲所属平台后查看评论')
  checkCurrent()
  const full = track.pending ? await resolvePending(track) : track
  checkCurrent()
  const id = String(full.id ?? '').trim()
  const numericId = /^[1-9]\d*$/.test(id) && (typeof full.id !== 'number' || Number.isSafeInteger(full.id)) ? id : undefined
  let identifiers: QueryParams
  if (source === 'netease') {
    if (!numericId) throw new Error('歌曲标识不可用，暂时无法读取评论')
    identifiers = { id: numericId }
  } else {
    const qq = qqLyricIdentifiers(full)
    identifiers = {
      id: qq.id ?? numericId,
      mid: qq.mid ?? (/^[A-Za-z0-9]{14}$/.test(id) && !/^\d+$/.test(id) ? id : undefined),
    }
    if (!identifiers.id && !identifiers.mid) throw new Error('歌曲标识不可用，暂时无法读取评论')
  }
  const result = await api.get<SongCommentsPage & { error?: string }>(source === 'qq' ? '/api/qq/song/comments' : '/api/song/comments',
    { ...identifiers, limit: 20, offset }, { signal })
  checkCurrent()
  if (result.error) throw new Error(result.error)
  if (!Array.isArray(result.comments) || !Array.isArray(result.hotComments)) throw new Error('平台没有返回有效评论')
  return {
    comments: result.comments,
    hotComments: result.hotComments,
    total: result.total ?? null,
    nextOffset: typeof result.nextOffset === 'number' && Number.isSafeInteger(result.nextOffset) && result.nextOffset > offset ? result.nextOffset : undefined,
  }
}
