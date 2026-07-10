# QQ 音乐 API 梳理

本文档梳理本项目 QQ 音乐音源涉及的接口：已接入的本地路由、以及尚未接入但公开可用的上游接口。上游均为 QQ 音乐 Web/客户端的非公开逆向接口（QQ 音乐无面向个人开发者的公开 OpenAPI）。

## 0. 基础信息

- 网关：`https://u.y.qq.com/cgi-bin/musicu.fcg`（POST，JSON body，`{ comm, <reqKey>: { module, method, param } }` 统一信封结构），少量老接口走 `c.y.qq.com` / `i.y.qq.com` 的独立 fcgi。
- 通用 Header：`Referer: https://y.qq.com/`、`User-Agent`（见 `server/lib/qq-client.ts` 的 `QQ_HEADERS`）。
- 鉴权：Cookie 中 `uin`（QQ 号,登录态 2 即微信登录时取 `wxuin`）+ `qm_keyst`/`qqmusic_key` 等票据（`qqCookieMusicKey`）。播放地址另需 `qqCookiePlaybackKey`,仅有网页登录态但缺播放票据时会命中 `104003` 限制。
- 音质候选前缀（`QQ_QUALITY_CANDIDATE_TEMPLATES`）：`RS01`(Hi-Res FLAC) > `F000`(无损 FLAC) > `M800`(320k MP3) > `M500`(128k MP3) > `C400`(AAC/M4A)，与三方逆向库 `qqmusic-api-python` 的 `SongFileType` 编码前缀基本对应（`F000`=FLAC、`M800`=MP3_320、`M500`=MP3_128、`C400`=ACC_96）。
- 官方开放平台 `developer.y.qq.com/docs/openapi` 面向 TME Connect/车机/大屏合作方,需企业资质接入,不适用于本项目这类个人/桌面播放器场景,不纳入接入计划。

---

## 1. 已有路由(`server/routes/qq-music.ts` + `server/lib/qq-client.ts`)

| 本地路由 | 用途 | 关键参数 | 上游接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/qq/search` | 关键词搜索歌曲 | `keywords`、`limit`(4~12) | `c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg`(联想词)→ 逐首 `music.pf_song_detail_svr/get_song_detail_yqq` 补详情 | `{ provider:'qq', songs: Track[] }` | 已用 |
| `GET /api/qq/song/url` | 取播放直链 | `mid`(或`id`)、`mediaMid`、`quality` | `vkey.GetVkeyServer/CgiGetVkey`(musicu.fcg) | `{ url, playable, level, quality, filename }`,失败带 `restriction`(login_required/copyright_unavailable/paid_required/url_unavailable) | 已用 |
| `GET /api/qq/lyric` | 取歌词 | `mid`/`id` | 优先 `music.musichallSong.PlayLyricInfo/GetPlayLyricInfo`(musicu.fcg),兜底 `c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg` | `{ lyric, tlyric, qrc, roma, source }` | 已用 |
| `GET /api/qq/login/status` | 查询登录态 | — | `c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg` | `{ loggedIn, userId, nickname, avatar, vipType, playbackKeyReady }` | 已用 |
| `POST /api/qq/login/cookie` | 保存用户手动粘贴的 cookie | body `cookie` | — | 校验含 `uin`+票据后写入,否则 400 | 已用 |
| `POST /api/qq/logout` | 清除 cookie | — | — | `{ ok:true }` | 已用 |
| `GET /api/qq/user/playlists` | 我创建+收藏的歌单 | — | `fcg_user_created_diss`(创建)+ `fcg_get_profile_order_asset.fcg`(收藏) | 过滤 QQ 空间背景音乐歌单,"我喜欢"置顶 | 已用 |
| `GET /api/qq/radar` | 私人雷达 | — | `music.recommend.TrackRelationServer/GetRadarSong` | `{ playlist, tracks }`;未登录或空结果返回 `playlist:null` | 已用 |
| `GET /api/qq/recommend/playlists` | 推荐歌单(真分页) | `page`(0 起) | `music.playlist.PlaylistSquare/GetRecommendFeed` | `{ playlists }`;`page` 映射 `From=page*20,Size=20` | 已用 |
| `GET /api/qq/recommend/songs` | 猜你喜欢 | — | `music.radioProxy.MbTrackRadioSvr/get_radio_track` | `{ songs }`;服务端循环最多 4 次按 mid 去重凑够 20 首 | 已用 |
| `GET /api/qq/playlist/tracks` | 歌单全量曲目 | `id`(disstid) | `qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg` | 一次性返回全部曲目(无分页窗口) | 已用 |
| `GET /api/qq/artist/detail` | 歌手详情+热门曲目 | `mid`、`limit`(10~80) | `music.web_singer_info_svr/get_singer_detail_info` | `{ artist, songs, total }` | 已用 |
| `GET /api/qq/search/artists` | 搜索歌手 | `keywords`、`limit`(1~10) | `music.search.SearchCgiService/DoSearchForQQMusicDesktop`(`search_type:1`) | `{ artists: [{id,mid,name,avatar,musicSize}] }`;该模块信封 key 须与 module 同名且不能带顶层 `comm`,已实测确认 | 已用 |
| `GET /api/qq/artist/songs` | 歌手歌曲(分页) | `id`(singermid)、`limit`(1~100)、`offset` | `musichall.song_list_server/GetSingerSongList` | `{ total, songs: Track[] }` | 已用 |
| `GET /api/qq/artist/albums` | 歌手专辑(分页) | `id`(singermid)、`limit`(1~80)、`offset` | `music.musichallAlbum.AlbumListServer/GetAlbumList` | `{ albums: Playlist[] }`;上游未返回专辑曲目数,`trackCount` 恒为 0 | 已用 |
| `GET /api/qq/song/comments` | 歌曲评论 | `id`/`mid`、`limit`、`offset` | `c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg` | 热评优先,分页用 `pagenum` | 已用 |

## 2. 可用但未接入(上游接口已验证存在,项目未使用)

来源:`server/lib/qq-client.ts` 之外、经三方逆向库(`l-1124/QQMusicApi`,Python,文档 https://l-1124.github.io/QQMusicApi/ )源码交叉核对的 `music.*` 模块方法。QQ 音乐无官方公开文档,以下 module/method 均来自逆向实现,存在随上游改版失效的风险。

| 功能 | 上游 module/method | 说明 | 建议用途 |
|---|---|---|---|
| 相似歌手 | `music.SimilarSingerSvr/GetSimilarSingerList` | 歌手页"相似歌手"卡片 | 歌手页视觉改版可选增强 |
| 歌手信息(新) | `music.UnifiedHomepage.UnifiedHomepageSrv/GetHomepageHeader` | 歌手主页头部信息,比 `get_singer_detail_info` 更新 | 可选替换现有歌手详情实现 |
| 相似歌曲 | `music.recommend.TrackRelationServer/GetSimilarSongs` | "相似歌曲"推荐 | 播放页"相似推荐"卡片 |
| 歌曲相关歌单 | 同上模块,`get_related_songlist` | 歌曲所属/相关歌单 | 歌曲详情页扩展 |
| 排行榜分类 | `music.musicToplist.Toplist/GetAll` | 所有排行榜列表(热歌榜/新歌榜/巅峰榜等) | 探索页新增"QQ 音乐排行榜"卡片 |
| 排行榜详情 | `music.musicToplist.Toplist/GetDetail` | 指定榜单的歌曲列表,支持分页 | 配合上一项 |
| 歌单详情(官方) | `music.srfDissInfo.DissInfo/CgiGetDiss` | 比现有 `fcg_ucc_getcdinfo_byids_cp.fcg` 更结构化的歌单详情 | 可选替换 |
| 用户歌单增删 | `music.musicasset.PlaylistBaseWrite/AddPlaylist`、`DelPlaylist` | 创建/删除歌单 | 对齐网易云 `/api/playlist/create` |
| 歌单加/删歌曲 | `music.musicasset.PlaylistDetailWrite/AddSonglist`、`DelSonglist` | 收藏歌曲到歌单 | 对齐网易云 `/api/playlist/add-song` |
| 热搜词 | `music.musicsearch.HotkeyService/GetHotkeyForQQMusicMobile` | 搜索框热搜词 | 搜索页可选增强 |
| MV 相关 | `MvService.MvInfoProServer/GetSingerMvList` | 歌手 MV 列表 | 暂无 MV 播放能力,先不接入 |

## 3. 内容推荐板块:QQ 音乐对齐网易云的能力

网易云的"每日推荐 / 私人雷达"在项目中分别是 `/api/netease/recommend/songs`(NCM `recommend_songs`)与 `/api/netease/radar`(固定共享歌单 id `3136952023` + 登录 cookie 的社区惯用做法)。QQ 音乐**没有**与网易云雷达完全等价的"固定歌单挂载"玩法,但有对应能力更接近官方语义的推荐接口:

| 网易云能力 | 本项目实现 | QQ 音乐对应上游 | 差异说明 |
|---|---|---|---|
| 每日推荐(dailySongs) | `recommend_songs` NCM 接口 | `music.radioProxy.MbTrackRadioSvr/get_radio_track`("猜你喜欢",单次约 5 首) | 非 Android 平台需要有效 `Credential`(即登录票据),量级比网易"每日30首"小,需多次翻页拼够
| 私人雷达(radar) | 固定歌单 id + cookie hack | `music.recommend.TrackRelationServer/GetRadarSong`("雷达推荐",真实雷达能力,支持分页 `Page`) | 无需 hack,是官方语义的雷达接口,是接入优先级最高的一项 |
| 推荐歌单(discover playlists) | `personalized`/`top_playlist` NCM 接口 | `music.playlist.PlaylistSquare/GetRecommendFeed` | 参数 `From`/`Size` 做游标分页,与网易 `page`/`limit` 语义可对齐 |
| 发现页综合流 | `handleDiscoverHome` 聚合多个 NCM 接口 | `music.recommend.RecommendFeed/get_recommend_feed`("主页推荐" feed,含多种卡片类型) | 单接口即返回多种卡片,结构与网易的"多接口聚合"思路不同,需要额外适配层拆分卡片类型 |
| (网易无对应) | — | `newsong.NewSongServer/get_new_song_info`("推荐新歌",按地区/语种筛选) | QQ 独有,可作为探索页补充卡片 |

**接入状态**:雷达推荐(`GetRadarSong`)、推荐歌单(`GetRecommendFeed`)、猜你喜欢(`get_radio_track`)已于 2026-07-10 接入,见第 1 节路由表与 `docs/superpowers/specs/2026-07-10-qq-explore-page-design.md`。

## 4. 需要探索的

- **`sign` 参数**:QQ 音乐近年对部分接口(如 `u6.y.qq.com/cgi-bin/musics.fcg`)加了签名校验,当前项目未命中该限制(仍用旧版 `musicu.fcg` 通道),若上游收紧需要专项逆向,参考社区文章(见来源)。
- **官方开放平台接入资质**:`developer.y.qq.com` 的 OpenAPI/SDK 面向车机、大屏、TME Connect 合作方,是否有面向个人开发者的白名单通道未确认,需要单独调研或放弃该路径。
- **QR 扫码登录**:当前项目 QQ 登录是用户手动粘贴 cookie(`/api/qq/login/cookie`),逆向库里存在完整二维码登录流程(`get_qrcode`/`check_qrcode`,依赖 `mu.y.qq.com` MQTT 长连接轮询扫码状态),体验优于手动 cookie,但实现复杂度高于网易云现有的 QR 轮询实现,值得后续评估。

## 5. 参考来源

- 本项目源码:`server/lib/qq-client.ts`、`server/routes/qq-music.ts`、`src/lib/qq-music-service.ts`
- [l-1124/QQMusicApi](https://github.com/l-1124/QQMusicApi)(Python,文档站 https://l-1124.github.io/QQMusicApi/ )— 本文档 module/method 名称的主要交叉验证来源,源码逐模块核对(`recommend.py`/`song.py`/`top.py`/`singer.py`/`search.py`/`lyric.py`/`login.py`/`songlist.py`)
- [copws/qq-music-api](https://github.com/copws/qq-music-api)(JS,2025.9 更新可用)
- [jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi)(Node.js)
- QQ 音乐官方开发者平台:https://developer.y.qq.com/docs/openapi (企业向,未确认个人开发者可用性)
