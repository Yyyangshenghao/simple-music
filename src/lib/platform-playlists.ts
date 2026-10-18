import { providerFor } from '../providers/registry'
import { isProviderParticipating } from '../stores/providers'
import { usePlatformPlaylistsStore } from '../stores/platform-playlists'
import { providerAccountSession } from './provider-account-session'
import { clearProviderRequestCache } from './provider-request-cache'
import { invalidatePlaylistCache } from '../hooks/useLazyPlaylist'
import type { MusicSource, Playlist } from '../types/domain'
import type { PlatformPlaylistCommand, PlatformPlaylistInspection, PlatformPlaylistMutationResult, WritablePlaylistSource } from '../types/platform-playlist'

export function isWritablePlaylistSource(source: MusicSource): source is WritablePlaylistSource {
  return source === 'netease' || source === 'qq'
}

export function supportsPlatformPlaylists(source: MusicSource): source is WritablePlaylistSource {
  return isWritablePlaylistSource(source) && !!providerFor(source).playlistWriter?.mutatePlatformPlaylist
}

function context(source: WritablePlaylistSource, signal?: AbortSignal) {
  const epoch = providerAccountSession(source)
  const assertCurrent = () => {
    if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError')
    if (epoch !== providerAccountSession(source) || !isProviderParticipating(source)) throw new Error('账号已变化，请重新打开歌单操作')
  }
  assertCurrent()
  const writer = providerFor(source).playlistWriter
  if (!writer?.getPlaylistManagementSession || !writer.inspectPlatformPlaylist || !writer.mutatePlatformPlaylist) throw new Error('当前平台暂不支持歌单管理')
  return { writer, assertCurrent }
}

export async function inspectPlatformPlaylist(source: WritablePlaylistSource, playlistId: string, signal?: AbortSignal): Promise<PlatformPlaylistInspection> {
  const { writer, assertCurrent } = context(source, signal)
  const session = await writer.getPlaylistManagementSession!(signal)
  assertCurrent()
  const result = await writer.inspectPlatformPlaylist!({ ...session, playlistId }, signal)
  assertCurrent()
  if (result.playlistId !== playlistId || typeof result.name !== 'string') throw new Error('平台歌单信息不完整，请刷新后重试')
  return result
}

export async function mutatePlatformPlaylist(source: WritablePlaylistSource, command: PlatformPlaylistCommand, signal?: AbortSignal): Promise<PlatformPlaylistMutationResult> {
  const epoch = providerAccountSession(source)
  const { writer, assertCurrent } = context(source, signal)
  if ((command.action === 'add' || command.action === 'remove') && command.tracks.some(track => track.source !== source)) throw new Error('只能操作与歌单同一平台的歌曲')
  const session = await writer.getPlaylistManagementSession!(signal)
  assertCurrent()
  let result: PlatformPlaylistMutationResult
  try {
    result = await writer.mutatePlatformPlaylist!({ ...session, ...command }, signal)
    assertCurrent()
  } finally {
    // 即便失败或取消，平台也可能已接受部分写入；旧缓存不能继续充当当前结果。
    if (providerAccountSession(source) === epoch) {
      clearProviderRequestCache(source)
      if ('playlistId' in command) invalidatePlaylistCache({ source, type: 'playlist', id: command.playlistId } as Playlist, { preserveSnapshot: true })
      usePlatformPlaylistsStore.getState().changed(source)
    }
  }
  return result
}

export function platformPlaylistResultMessage(result: PlatformPlaylistMutationResult, action: PlatformPlaylistCommand['action']): string {
  const verb = { create: '新建', rename: '改名', add: '加入', remove: '移除' }[action]
  if (result.status === 'unknown' || result.completed === null) return `平台结果尚未确认，请刷新歌单查看，避免重复操作。${result.error || ''}`
  if (result.status === 'partial') return `${action === 'add' || action === 'remove' ? `已${verb} ${result.completed}/${result.requested} 首。` : `歌单${verb}未完成。`}${result.error || '部分操作未完成，请刷新歌单查看'}`
  return action === 'create' ? '已新建平台歌单' : action === 'rename' ? '歌单已改名' : `已${verb} ${result.completed} 首歌曲`
}
