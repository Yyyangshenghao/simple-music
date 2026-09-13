# QQ 音乐 API 梳理

本文档梳理本项目 QQ 音乐音源涉及的接口：已接入的本地路由、以及尚未接入但公开可用的上游接口。上游均为 QQ 音乐 Web/客户端的非公开逆向接口（QQ 音乐无面向个人开发者的公开 OpenAPI）。

下一轮产品范围与实施优先级见 [QQ 音乐板块下一轮需求 TODO（2026-08-25）](./qq-music-product-todo-2026-08-25.md)。

## 0. 基础信息

- 网关：`https://u.y.qq.com/cgi-bin/musicu.fcg`（POST，JSON body，`{ comm, <reqKey>: { module, method, param } }` 统一信封结构），少量老接口走 `c.y.qq.com` / `i.y.qq.com` 的独立 fcgi。
- 通用 Header：`Referer: https://y.qq.com/`、`User-Agent`（见 `server/lib/qq-client.ts` 的 `QQ_HEADERS`）。
- 鉴权：Cookie 中 `uin`（QQ 号,登录态 2 即微信登录时取 `wxuin`）+ `qm_keyst`/`qqmusic_key` 等票据（`qqCookieMusicKey`）。播放地址另需 `qqCookiePlaybackKey`,仅有网页登录态但缺播放票据时会命中 `104003` 限制。
- 音质候选前缀（`QQ_QUALITY_CANDIDATE_TEMPLATES`）：`RS01`(Hi-Res FLAC) > `F000`(无损 FLAC) > `M800`(320k MP3) > `M500`(128k MP3) > `C400`(AAC/M4A)，与三方逆向库 `qqmusic-api-python` 的 `SongFileType` 编码前缀基本对应（`F000`=FLAC、`M800`=MP3_320、`M500`=MP3_128、`C400`=ACC_96）。
- 官方开放平台 `developer.y.qq.com/docs/openapi` 面向 TME Connect/车机/大屏合作方,需企业资质接入,不适用于本项目这类个人/桌面播放器场景,不纳入接入计划。
- 候选接口不能只凭第三方仓库源码判定可用。第 2.2~2.3 节仅收录 **2026-08-24 真实请求成功** 的只读接口；会改变账号数据的接口单独放在第 2.4 节,未完成专用测试前不得标记为可用。

---

## 1. 已有路由(`server/routes/qq-music.ts` + `server/lib/qq-client.ts`)

| 本地路由 | 用途 | 关键参数 | 上游接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/qq/search` | 关键词搜索歌曲 | `keywords`、`limit`(4~20) | `music.search.SearchCgiService/DoSearchForQQMusicDesktop`(`search_type:0`) | 单次请求映射完整 `Track`,不再逐首补详情 | 已用 |
| `GET /api/qq/search/hotkeys` | 空搜索热词 | — | `music.musicsearch.HotkeyService/GetHotkeyForQQMusicMobile` | `{ provider:'qq', keywords:string[] }`；匿名请求，按 `query` 去空、去重、保序取前 10，失败返回 502 与空数组 | 已用 |
| `GET /api/qq/song/url` | 取播放直链 | `mid`(或`id`)、`mediaMid`、`quality` | `vkey.GetVkeyServer/CgiGetVkey`(musicu.fcg) | `{ url, playable, level, quality, filename }`,失败带 `restriction`(login_required/copyright_unavailable/paid_required/url_unavailable) | 已用 |
| `GET /api/qq/song/qualities` | 探测单曲真实可用音质 | `mid`(或`id`)、`mediaMid` | `vkey.GetVkeyServer/CgiGetVkey`(一次携带全部候选 filename) | `{ qualities:[{level,label}] }`,仅保留返回 `purl` 的档位 | 已用 |
| `GET /api/qq/song/similar` | 队列“发现相似音乐”的相似歌曲 | `songid`（数字 `qqId`，非 MID） | `music.recommend.TrackRelationServer/GetSimilarSongs` | `{ provider:'qq', songs }`；匿名请求、按 MID 去重并排除种子曲，最多 10 首；非法 ID 返回 400，上游失败返回 502 | 已用 |
| `GET /api/qq/song/related-playlists` | 当前歌曲的相关歌单 | `songid`、`previousIds`（可选，最多 30 个逗号分隔的数字歌单 ID） | `music.recommend.TrackRelationServer/GetRelatedPlaylist` | `{ provider:'qq', playlists, hasMore }`；匿名请求，上一批 ID 传入 `vecPlaylist`，过滤重复/旧批次；非法 ID 返回 400，上游失败返回 502 | 已用 |
| `GET /api/qq/lyric` | 取歌词 | `mid`/`id` | 优先 `music.musichallSong.PlayLyricInfo/GetPlayLyricInfo`(musicu.fcg),兜底 `c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg` | `{ lyric, tlyric, qrc, roma, source }` | 已用 |
| `GET /api/qq/login/status` | 查询登录态 | — | `c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg` | `{ loggedIn, userId, nickname, avatar, vipType, playbackKeyReady }` | 已用 |
| `POST /api/qq/login/cookie` | 保存登录窗口捕获或手动输入的 cookie | body `cookie` | — | Electron 登录窗默认自动捕获；接口校验含 `uin`+票据后写入,否则 400 | 已用 |
| `POST /api/qq/logout` | 清除 cookie | — | — | `{ ok:true }` | 已用 |
| `GET /api/qq/user/playlists` | 我创建+收藏的歌单 | — | `fcg_user_created_diss`(创建)+ `fcg_get_profile_order_asset.fcg`(收藏) | 过滤 QQ 空间背景音乐歌单,"我喜欢"置顶 | 已用 |
| `GET /api/qq/liked/playlist` | “我喜欢”入口 meta | — | `music.srfDissInfo.DissInfo/CgiGetDiss`(`dirid:201`) | 仅取 1 首辅助封面，空收藏仍返回 `qq-liked:201`；未登录/失效返回 401/403 | 已用 |
| `GET /api/qq/radar` | 私人雷达 | — | `music.recommend.TrackRelationServer/GetRadarSong` | `{ playlist, tracks }`;未登录或空结果返回 `playlist:null`。**已实测**:返回体是 `data.VecSongs`(数组项包一层 `{Track:{...}}`),`Page` 为真分页(`Page:1` 仅 1 首种子曲,`Page:2+` 每页约 10 首,`data.HasMore` 标记),服务端循环最多 4 页凑够 30 首 | 已用 |
| `GET /api/qq/recommend/playlists` | 推荐歌单(真分页) | `page`(0 起) | `music.playlist.PlaylistSquare/GetRecommendFeed` | `{ playlists }`;`page` 映射 `From=page*20,Size=20`。**已实测**:数组在 `data.List`,每项是三层嵌套 `{Playlist:{basic:{tid,title,cover:{medium_url,...},creator:{nick,...},song_cnt,play_cnt}}}`,专用 `mapQQFeedPlaylist` 映射(不复用通用 `mapQQPlaylist`,字段形状不兼容) | 已用 |
| `GET /api/qq/recommend/songs` | 猜你喜欢 | — | `music.radioProxy.MbTrackRadioSvr/get_radio_track` | `{ songs }`;服务端循环最多 4 次按 mid 去重凑够 20 首。**已实测**:数组在 `data.tracks`(命中既有候选),每项是扁平结构(`mid`/`name`/`singer`/`album`/`interval`/`file`/`pay` 直接在顶层),与 `mapQQPlaylistTrack` 现有解析天然兼容,无需额外映射 | 已用 |
| `GET /api/qq/toplist` | 排行榜分组与 Top3 | — | `music.musicToplist.Toplist/GetAll` | `{ groups: ToplistGroup[] }`;榜单 ID 编码为 `qq-toplist:<topId>` | 已用 |
| `GET /api/qq/toplist/preview` | 补拉榜单 Top3 | `id`(`qq-toplist:<topId>`) | `music.musicToplist.Toplist/GetDetail` | `{ preview }`;仅请求前 3 首,GetAll 已带预览时客户端不会调用 | 已用 |
| `GET /api/qq/playlist/tracks` | 歌单全量曲目 | `id`(`disstid`/`qq-liked:201`/`qq-toplist:<topId>`) | 普通歌单与“我喜欢”走 `CgiGetDiss`,榜单走 `Toplist/GetDetail` | 服务端按上游分页取全并返回有序 `trackIds`/`tracks` | 已用 |
| `GET /api/qq/artist/detail` | 歌手详情+热门曲目 | `mid`、`limit`(10~80) | `music.web_singer_info_svr/get_singer_detail_info` | `{ artist, songs, total }`;客户端与服务端统一传歌手 MID | 已用 |
| `GET /api/qq/artist/similar` | 相似歌手 | `mid`、`limit`(1~30) | `music.SimilarSingerSvr/GetSimilarSingerList` | `{ artists }`;按歌手 MID 去重并排除当前歌手；上游失败返回 502，明确鉴权错误返回 401/403 | 已用 |
| `GET /api/qq/search/artists` | 搜索歌手 | `keywords`、`limit`(1~10) | `music.search.SearchCgiService/DoSearchForQQMusicDesktop`(`search_type:1`) | `{ artists: [{id,mid,name,avatar,musicSize}] }`;该模块信封 key 须与 module 同名且不能带顶层 `comm`,已实测确认 | 已用 |
| `GET /api/qq/artist/songs` | 歌手歌曲(分页) | `id`(singermid)、`limit`(1~100)、`offset` | `musichall.song_list_server/GetSingerSongList` | `{ total, songs: Track[] }` | 已用 |
| `GET /api/qq/artist/albums` | 歌手专辑(分页) | `id`(singermid)、`limit`(1~80)、`offset` | `music.musichallAlbum.AlbumListServer/GetAlbumList` | `{ albums: Playlist[] }`;列表摘要的 `trackCount` 可能为 0，进入详情后按需补齐 | 已用 |
| `GET /api/qq/album/detail` | 专辑详情 meta | `mid`(albumMid) | `music.musichallAlbum.AlbumInfoServer/GetAlbumDetail` | `{ playlist }`;映射发行日、唱片公司、简介；`trackCount: 0` 表示未知，页面曲目数以歌曲列表为准 | 已用 |
| `GET /api/qq/album/songs` | 专辑全量曲目 | `mid`/`id`(albummid) | `music.musichallAlbum.AlbumSongList/GetAlbumSongList` | `{ total, songs: Track[] }`;当前一次取最多 300 首 | 已用 |
| `GET /api/qq/song/comments` | 歌曲评论 | `id`/`mid`、`limit`、`offset` | `c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg` | 热评优先,分页用 `pagenum` | 已用 |

## 2. 已实测上游接口与接入状态

### 2.1 实测口径与通用信封

- 实测时间:`2026-08-24`。
- 网关:`POST https://u.y.qq.com/cgi-bin/musicu.fcg`。
- 除“我喜欢”读取外均用 `uin: "0"`、不带 Cookie 的显式匿名请求验证；“我喜欢”使用本机 QQ 登录态做只读验证。
- 成功标准:HTTP 成功、外层请求块 `code === 0`、目标数组非空且关键字段形状符合本节记录。测试未输出 Cookie、用户资料或具体收藏内容。
- Web 通用信封如下；业务请求 key 可自定义为 `req_0`,响应使用相同 key。布尔参数必须保留 JSON boolean,不要序列化成 `0/1`。

```json
{
  "comm": {
    "ct": 24,
    "cv": 4747474,
    "platform": "yqq.json",
    "uin": "0",
    "g_tk": 5381,
    "g_tk_new_20200303": 5381,
    "format": "json",
    "inCharset": "utf-8",
    "outCharset": "utf-8",
    "notice": 0,
    "need_new_code": 1
  },
  "req_0": {
    "module": "<module>",
    "method": "<method>",
    "param": {}
  }
}
```

登录接口把 `comm.uin` 换成账号 UIN、补 `comm.authst = qm_keyst/qqmusic_key`,并同时带 Cookie。实际实现应复用 `qqAuthComm()` 与 `qqMusicRequest()`,不要另建第二套鉴权拼装。

### 2.2 本轮接入与近期候选

| 优先级 | 功能 | module / method | `param` | 关键返回字段 | 2026-08-24 实测 |
|---|---|---|---|---|---|
| P0 | “我喜欢”歌曲（已接入） | `music.srfDissInfo.DissInfo/CgiGetDiss` | `{ disstid:0, dirid:201, tag:true, song_begin, song_num, userinfo:true, orderlist:true }` | `data.dirinfo`、`songlist[]`、`total_song_num`、`hasmore` | 登录态只读成功,返回首批 5 首 |
| P1 | 相似歌手（已接入） | `music.SimilarSingerSvr/GetSimilarSingerList` | `{ singerMid, number }` | `data.singerlist[]`;含 `singerId/singerMid/singerName/singerPic` | 匿名成功,`singerMid:"0025NhlN2yWrP4"` 返回 5 位 |
| P1 | 专辑详情（已接入） | `music.musichallAlbum.AlbumInfoServer/GetAlbumDetail` | `{ albumMId }`或数字 ID 时`{ albumId }`;注意 MID 参数大小写是 `albumMId` | `data.basicInfo`、`company`、`singer.singerList` | 匿名成功；2026-08-30 确认 `publishDate/desc/company.name`，并确认 `albumDuration` 不能当作曲目数 |

**正式搜索特殊规则（已接入）:**此模块在当前 Web 通道必须以 module 名作为信封 key,并且不带顶层 `comm`;否则可能返回空数据。请求形状:

```json
{
  "music.search.SearchCgiService": {
    "module": "music.search.SearchCgiService",
    "method": "DoSearchForQQMusicDesktop",
    "param": {
      "search_type": 0,
      "query": "周杰伦",
      "page_num": 1,
      "num_per_page": 20
    }
  }
}
```

### 2.3 后续内容扩展储备

| 功能 | module / method | `param` | 关键返回字段 | 2026-08-24 实测与注意事项 |
|---|---|---|---|---|
| 相似歌曲（已接入） | `music.recommend.TrackRelationServer/GetSimilarSongs` | `{ songid }`;必须用数字歌曲 ID,不是 MID | 兼容 `data.vecSong[].track` 与 `vecSongNew[].songs[].track` | 2026-08-30 匿名复验 `songid:5105986` 返回 10 首；分组新结构按上游模型补测试，当前实测为空 |
| 歌曲相关歌单（已接入） | `music.recommend.TrackRelationServer/GetRelatedPlaylist` | `{ songid, vecPlaylist:[] }`;换一批时把上一批数字歌单 ID 放入 `vecPlaylist` | 兼容 `data.vecPlaylist[]` 与 `vecPlaylistNew[].playlists[]`、`hasMore`；数量字段为 `songNum` | 2026-08-30 匿名复验返回 3 个歌单，回传上一批 ID 后得到不同歌单；当前新结构为空 |
| 热搜词（已接入） | `music.musicsearch.HotkeyService/GetHotkeyForQQMusicMobile` | `{ search_id }`;使用一次性搜索会话 ID 字符串 | `data.vec_hotkey[]`;本地仅使用 `query`，不执行跳转、不预搜歌曲 | 2026-08-30 匿名复验成功，返回 30 条 |
| 推荐新歌 | `newsong.NewSongServer/get_new_song_info` | `{ type }`;`1=内地,2=欧美,3=日本,4=韩国,5=最新,6=港台` | `data.songlist[]`、`lanlist`、`songTagInfoList` | 匿名成功,`type:5` 返回 50 首 |

### 2.4 写接口参数与验证状态

以下接口在 `l-1124/QQMusicApi` 源码中有实现，但会真实修改用户账号，**源码存在不代表当前 Web 通道可用**。2026-08-30 已在用户准备的测试登录态下尝试红心添加，返回业务码 `80105` 且读回未生效；普通歌单创建/删除与加歌/删歌仍未做副作用测试。接入前必须通过写入、幂等、回滚与错误码验证。

写入成功必须同时检查 HTTP、外层 `code`、目标业务块 `code` 和 `data.retCode`，并在测试中读回确认。此次 `AddSonglist` 返回外层 `0`、业务块 `80105`、内层 `retCode:0`，只检查 `retCode` 会误报成功；上游解析器同样先拒绝非零业务码，见 [请求响应解析](https://github.com/L-1124/QQMusicApi/blob/main/qqmusic_api/core/request.py)。

| 操作 | module / method | `param` | 成功判定/备注 |
|---|---|---|---|
| 创建歌单 | `music.musicasset.PlaylistBaseWrite/AddPlaylist` | `{ dirName }` | `data.retCode === 0`;结果包含 `result.tid/dirId/dirName` |
| 删除歌单 | `music.musicasset.PlaylistBaseWrite/DelPlaylist` | `{ dirId }` | `data.retCode === 0`;只能用专用测试歌单验证 |
| 歌单加歌 | `music.musicasset.PlaylistDetailWrite/AddSonglist` | `{ dirId, tid, bFmtUtf8:true, v_songInfo:[{songId,songType}] }` | 内层 `retCode === 0`;`songId` 是数字 ID,不是 MID |
| 歌单删歌 | `music.musicasset.PlaylistDetailWrite/DelSonglist` | 同上 | 内层 `retCode === 0`;删除前必须读取并保存原曲目用于回滚 |
| 收藏/取消收藏歌曲 | 复用 `AddSonglist/DelSonglist` | 固定 `dirId:201`,`tid:0`,其余同上 | 添加实测被拒绝（业务码 80105），尚未验证撤销和重复操作；暂不开放红心 |

验证边界：只针对快照中不存在的一首测试曲尝试添加，现有 `ct:19` 登录信封与 [版本策略中定义的 Web 信封](https://github.com/L-1124/QQMusicApi/blob/main/qqmusic_api/core/versioning.py)（`ct:24`、`cv:4747474`，从登录 key 计算 `g_tk` / `g_tk_new_20200303`）均被拒绝。两次尝试后原始收藏 ID、类型、顺序均确认未变，未执行其他账号写操作。`80105` 的具体含义尚未确认，不按登录失效处理；下一步先对照官方客户端，再判断账号限制或请求兼容性。写参数来源已复核 [当前歌单实现](https://github.com/L-1124/QQMusicApi/blob/main/qqmusic_api/modules/songlist.py)，不回退旧失效接口，也不引入 Android 设备会话绕过当前验证门槛。

### 2.5 项目接入落点

- 正式搜索:已替换 `handleQQSearch` 的 smartbox + N 次歌曲详情请求；本地 `/api/qq/search` 路由与 `QQMusicService.searchTracks()` 签名保持不变。
- 排行榜:已接入 QQ toplist 分组与预览路由，`QQMusicService.getToplists()`/`getToplistPreview()` 复用现有 `ToplistSection`、`ToplistCard` 与 `ToplistPage`。
- “我喜欢”:已实现只读 `getLikedPlaylist()` 与 `qq-liked:201` 详情分流；本轮不声明 `checkLiked()`/`likeTrack()`，避免出现不可写的红心交互。后续实现状态查询时应按歌曲 MID 回填，确认写接口后再使用完整 `Track` 上的 `qqId` + `songType` 写入。
- “我喜欢”详情:实现 `getLikedPlaylist()` 时必须同时保证入口可打开。可新增专用 `/api/qq/liked/tracks`,或让 `/api/qq/playlist/tracks` 对 liked 虚拟 ID 特判转调 `CgiGetDiss(dirid:201)`；不能只返回一个歌单 meta,否则探索快捷入口和“我的库”能显示但无法加载曲目。
- 相似歌手:已实现 `QQMusicService.getSimilarArtists()`，`Artist.id` 与请求参数均为 `singerMid`，自动复用歌手页标签和漫游歌手图谱扩展；数字歌手 ID 仅保留在 `qqArtistId`。
- 官方歌单详情:已替换旧 `fcg_ucc_getcdinfo_byids_cp.fcg` 并由服务端按上游分页取全；`PlaylistSkeleton` 直接携带完整有序曲目，不留下待补窗口。
- 专辑详情:已在进入 QQ 专辑页时按需补拉，使用现有 `creator/tag/description` 显示歌手、发行日、唱片公司和简介；专辑曲目及页面曲目数仍复用 `GetAlbumSongList`，没有扩张领域字段。补拉失败或缺字段保留原摘要，切换专辑或来源后不展示旧详情。
- 曲目数核验:2026-08-30 匿名读取专辑 `002MAeob3zLXwZ`，`basicInfo.albumDuration` 为 10，但 `GetAlbumSongList.totalNum` 为 5，因此详情 meta 不映射该字段，`trackCount` 保持未知值 0。
- 搜索热词:通过可选 `catalog.getSearchHotkeys()` 能力接入顶栏空搜索，仅展示当前内容平台的热词，且要求已登录、已启用；网易云、QQ 均已接入，切平台时切换对应热搜，不混合展示。点击只填词，后续复用原跨平台防抖搜索；失败不影响普通搜索。上游字段同时参照 [QQMusicApi 搜索实现](https://github.com/L-1124/QQMusicApi/blob/main/qqmusic_api/modules/search.py) 与 [响应模型](https://github.com/L-1124/QQMusicApi/blob/main/qqmusic_api/models/search.py)，并经匿名实测核验。
- 相似歌曲/相关歌单:通过可选 `catalog.getSimilarTracks(track)` / `getRelatedPlaylists(track, previousIds)` 接入播放队列底部“发现相似音乐”。只有当前 QQ 曲目具备数字 `qqId` 且平台已登录、启用时可见，展开才请求；歌曲仅追加并防重复，歌单点击进入详情，换批携带上一批 ID。切歌或关闭后不回写旧数据，两类推荐独立降级。字段参照 [QQMusicApi 歌曲实现](https://github.com/L-1124/QQMusicApi/blob/main/qqmusic_api/modules/song.py) 与 [响应模型](https://github.com/L-1124/QQMusicApi/blob/main/qqmusic_api/models/song.py)，旧结构及换批经匿名实测核验。
- 推荐新歌:当前没有独立产品入口，继续延期，不提前扩展通用接口。

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
- **新版歌手主页**:`music.UnifiedHomepage.UnifiedHomepageSrv/GetHomepageHeader` 使用 `{ SingerMid }` 在 2026-08-24 的当前 Web 信封下外层返回 `code:10000`,不能列入可用清单。第三方实现固定走 Android 平台并依赖 Android session/QIMEI；现有歌手详情可用,暂不为此引入整套设备会话。
- **账号写接口**:第 2.4 节只留存现代请求参数,没有完成副作用测试。旧 `c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg` 等接口已有失效报告,不要回退使用。
- **官方开放平台接入资质**:`developer.y.qq.com` 的 OpenAPI/SDK 面向车机、大屏、TME Connect 合作方,是否有面向个人开发者的白名单通道未确认,需要单独调研或放弃该路径。
- **独立扫码 API**:当前 Electron QQ 登录窗会加载 QQ 音乐官方登录页并自动捕获 Cookie,页面本身可走二维码登录,因此暂不实现 `mu.y.qq.com` MQTT 扫码流程。只有官方页面无法稳定登录时再评估独立方案。

## 5. 参考来源

- 本项目源码:`server/lib/qq-client.ts`、`server/routes/qq-music.ts`、`src/lib/qq-music-service.ts`
- [l-1124/QQMusicApi](https://github.com/l-1124/QQMusicApi)(Python,文档站 https://l-1124.github.io/QQMusicApi/ )— 参数留档主要来源,核对版本为 `108617ffe80abefec6358717b9f4d3677550db10`(2026-08-05);源码存在不等于接口可用,第 2 节另做真实请求验证
- [copws/qq-music-api](https://github.com/copws/qq-music-api)(JS,2025.9 更新可用)
- [jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi)(Node.js)— 功能目录参考;主分支 HEAD `13b08afd3180cc74d76fff208956b77a560abd22` 停在 2022-07-09,不得直接按其旧 URL 判断可用性
- QQ 音乐官方开发者平台:https://developer.y.qq.com/docs/openapi (企业向,未确认个人开发者可用性)
