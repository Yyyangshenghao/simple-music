import type { Playlist } from '../../types/domain'

/** 仅补当前专辑的展示字段；迟到的其他专辑详情和缺失字段不覆盖原摘要。 */
export function mergeAlbumDetail(playlist: Playlist, detail: Playlist | null): Playlist {
  if (
    playlist.type !== 'album'
    || detail?.type !== 'album'
    || detail.source !== playlist.source
    || String(detail.id) !== String(playlist.id)
  ) return playlist

  return {
    ...playlist,
    name: detail.name || playlist.name,
    cover: detail.cover || playlist.cover,
    creator: detail.creator || playlist.creator,
    tag: detail.tag || playlist.tag,
    description: detail.description || playlist.description,
  }
}
