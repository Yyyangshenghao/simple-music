import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export interface MusicService {
  /** 推荐歌单分页拉取：page 0 为个性化推荐，之后每页拉更远的一批（可无限翻页的音源按 page 返回不同内容）。 */
  getRecommendPlaylists(page?: number): Promise<Playlist[]>
  /** 歌单骨架:完整 trackIds(顺序即歌单顺序)+ 已带详情的前缀批次(QQ/小歌单可能就是全部)。 */
  getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton>
  /** 按 id 批量补曲目详情;返回顺序与入参一致,查不到的跳过。 */
  getTracksByIds(ids: unknown[]): Promise<Track[]>
  searchTracks(keyword: string): Promise<Track[]>
  searchArtists(keyword: string): Promise<ArtistInfo[]>
  getArtistDetail(id: unknown): Promise<ArtistInfo>
  getArtistSongs(id: unknown): Promise<Track[]>
  /** 相似歌手（可选；未实现的音源不渲染相似歌手胶囊）。 */
  getSimilarArtists?(id: unknown): Promise<ArtistInfo[]>
  /** 近一周听歌排行（可选；网易专属，用于漫游页猜测常听歌手）。 */
  getListeningRanking?(): Promise<Track[]>
  getArtistAlbums(id: unknown): Promise<Playlist[]>
  /** 专辑曲目全量拉取(`Playlist.type === 'album'` 的详情页用;专辑规模小,不走懒加载)。 */
  getAlbumTracks(id: unknown): Promise<Track[]>
  getTrackUrl(track: Track): Promise<string>
  getLyrics(track: Track): Promise<LyricLine[]>
  /** 每日/猜你喜欢曲目推荐（可选；未实现的音源不渲染该卡片）。 */
  getDailySongs?(): Promise<Track[]>
  /** 私人雷达歌单（可选；null = 不可用，隐藏卡片）。 */
  getRadarPlaylist?(): Promise<RadarPlaylist | null>
  /** 最近播放歌单（网易专属，账号级播放记录；空数组 = 未登录或无记录，隐藏栏目）。 */
  getRecentPlaylists?(): Promise<Playlist[]>
  /** 官方榜单(飙升榜/新歌榜/热歌榜等;可选,不含账号数据,未登录也能拿)。榜单本身就是歌单,
   *  返回值可直接丢进 PlaylistDetailView 复用懒加载详情。 */
  getToplists?(): Promise<Playlist[]>
  /** 红心/取消红心（可选;未实现的音源不渲染红心按钮）。resolve true 表示服务端成功。 */
  likeTrack?(track: Track, like: boolean): Promise<boolean>
  /** 批量查询红心状态,key 为 String(id)（可选,需登录）。 */
  checkLiked?(ids: unknown[]): Promise<Record<string, boolean>>
  /** "我喜欢的音乐"歌单（可选;null = 未登录或不可用）。 */
  getLikedPlaylist?(): Promise<Playlist | null>
  /** 当前账号的歌单列表（可选;网易/QQ 各有自己的端点,本地音乐无此概念）。未登录返回空数组。 */
  getUserPlaylists?(): Promise<Playlist[]>
  /** 按名字列出账号歌单候选项（可选;仅网易实现,漫游功能用于识别归属;含 description 供调用方按业务规则筛选,如水印校验）。 */
  findUserPlaylistsByName?(name: string): Promise<PlaylistMeta[]>
  /** 按 id 取歌单当前 meta(含 description)+ 全部曲目（可选;仅网易实现）。找不到返回 null。 */
  getPlaylistWithDescription?(id: unknown): Promise<{ playlist: PlaylistMeta; tracks: Track[] } | null>
  /** 建歌单,返回新歌单 id（可选;仅网易实现）。 */
  createPlaylist?(name: string, opts: { private: boolean }): Promise<{ id: unknown }>
  /** 清空歌单当前曲目并替换为新的一批（可选;仅网易实现）。 */
  replacePlaylistTracks?(playlistId: unknown, currentTrackIds: unknown[], newTrackIds: unknown[]): Promise<boolean>
  /** 覆盖歌单简介（可选;仅网易实现）。 */
  updatePlaylistDescription?(playlistId: unknown, description: string): Promise<boolean>
  /** 听歌打卡上报（可选;仅网易实现）。更新账号端"最近播放歌单"/"听歌排行"等真实数据；
   *  sourceId 为播放来源的歌单/专辑 id，缺省时上游按歌曲自身 id 兜底。失败静默忽略,不影响播放。 */
  reportPlayback?(trackId: unknown, opts: { sourceId?: unknown; seconds: number }): Promise<void>
}

export interface RadarPlaylist {
  playlist: Playlist
  tracks: Track[]
}

export interface PlaylistSkeleton {
  trackIds: unknown[]
  tracks: Track[]
}

/** 漫游功能用的轻量歌单 meta——只包含实际会用到的字段,不是完整的 Playlist。 */
export interface PlaylistMeta {
  id: unknown
  name: string
  description: string
}
