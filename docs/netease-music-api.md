# 网易云音乐 API 梳理

本文档梳理本项目实际在用的网易云音乐端点。全部基于 npm 包 [`NeteaseCloudMusicApi`](https://github.com/Binaryify/NeteaseCloudMusicApi)(`^4.32.0`,见 `package.json`)封装,本地路由通过 `server/lib/netease-client.ts` 的 `call(name, params)` 调用该包导出的接口函数,`name` 即该包的接口名(如 `personalized`、`song_url_v1`)。以下表格中"NCM 接口"列即该包的函数名,可在其仓库 `router/*.js` 找到对应实现与官方参数说明。

## 0. 基础信息

- 鉴权:Cookie 中 `MUSIC_U` 为登录票据,`server/lib/cookie.ts` 负责本地持久化(`userDataDir` 下)。
- 音质候选(`NETEASE_QUALITY_CANDIDATES`):`jymaster`(超清母带,需 SVIP)> `hires`(高清臻音)> `lossless`(无损)> `exhigh`(极高)> `higher`(较高)> `standard`(标准),取歌曲 URL 时按此优先级降级探测,命中 `freeTrialInfo` 视为试听片段而非完整播放地址。
- `Track.duration` 取网易 `dt` 字段原样(毫秒)。

---

## 1. 登录(`routes/netease.ts`)

| 路由 | 用途 | 关键参数 | NCM 接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/login/qr/key` | 生成二维码登录 key | — | `login_qr_key` | `{ key }` | 已用 |
| `GET /api/login/qr/create` | 生成二维码图片 | `key` | `login_qr_create`(`qrimg:true`) | `{ img, url }` | 已用 |
| `GET /api/login/qr/check` | 轮询扫码状态 | `key` | `login_qr_check` | `code`:800 过期/801 待扫/802 已扫待确认/803 成功;成功时写入 cookie 并返回登录信息 | 已用 |
| `POST /api/login/cookie` | 手动粘贴 cookie 登录 | body `cookie` | — | 校验含 `MUSIC_U`,写入后查询登录态 | 已用 |
| `GET /api/login/status` | 查询登录态 | — | `login_status`(主) / `user_account`(兜底) | `{ loggedIn, userId, nickname, avatar, vipType, vipLevel, isVip, isSvip, vipLabel }` | 已用 |
| `POST /api/logout` | 登出 | — | `logout` | 清 cookie | 已用 |

## 2. 发现页 / 首页推荐(`routes/netease.ts`)

| 路由 | 用途 | 关键参数 | NCM 接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/discover/home` | 发现页聚合(未登录返回 starter 模式空态) | — | `personalized`(推荐歌单)+ `dj_hot`(热门播客)+ `recommend_resource`(私人推荐歌单)+ `recommend_songs`(每日推荐)并发 | `{ loggedIn, user, dailySongs, playlists, podcasts }` | 已用 |
| `GET /api/netease/banner` | 首页 Banner | — | `banner`(`type:0`) | 取前 5 条,`track` 字段随行内嵌歌曲信息 | 已用 |
| `GET /api/netease/recommend/playlists` | 探索页 Stack 池子 | `page`(0=个性化推荐,≥1=歌单广场热门分页) | `page===0`:`personalized`;`page>=1`:`top_playlist`(`order:'hot'`,`offset:(page-1)*30`) | `{ playlists }`,支持无限翻页(page≥1 走广场分页) | 已用 |
| `GET /api/netease/recommend/songs` | 每日推荐(dailySongs) | — | `recommend_songs` | 取 `data.dailySongs`,前 20 首 | 已用 |
| `GET /api/netease/radar` | 私人雷达 | — | `playlist_detail`(固定歌单 id `3136952023` + 登录 cookie) | 未登录直接返回空;社区通行做法,非官方专属雷达接口 | 已用 |
| `GET /api/netease/recent/playlists` | 账号级"最近播放"歌单 | — | `record_recent_playlist`(`limit:12`) | 需登录,未登录返回空数组 | 已用 |

## 3. 搜索(`routes/netease.ts`)

| 路由 | 用途 | 关键参数 | NCM 接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/search` | 综合搜索歌曲 | `keywords`、`limit` | `cloudsearch` | 结果缺封面时用 `song_detail` 批量兜底补齐 | 已用 |
| `GET /api/search/artists` | 搜索歌手 | `keywords`、`limit`(1~5) | `cloudsearch`(`type:100`) | `{ artists }` | 已用 |

## 4. 歌手(`routes/netease.ts`)

| 路由 | 用途 | 关键参数 | NCM 接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/netease/artist/detail` | 歌手基础信息 | `id` | `artist_detail` | `{ artist }` | 已用 |
| `GET /api/netease/artist/songs` | 歌手歌曲 | `id`、`limit` | `artist_songs` | `{ songs }` | 已用 |
| `GET /api/netease/artist/albums` | 歌手专辑 | `id`、`limit` | `artist_album` | `{ albums }` | 已用 |
| `GET /api/artist/detail` | 歌手主页(通用,详情+热门曲目一体) | `id`、`limit`(10~80) | `artist_detail` + `artist_songs`(`order:'hot'`,失败兜底 `artist_top_song`) | `{ artist, songs }`,与 `/api/netease/artist/*` 功能有重叠(通用路由供跨音源统一入口使用) | 已用 |

## 5. 歌曲播放 / 详情 / 歌词(`routes/netease.ts`)

| 路由 | 用途 | 关键参数 | NCM 接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/song/url` | 取播放直链 | `id`、`quality` | `song_url_v1`(按 `level` 降级探测,失败兜底旧版 `song_url` 按 `br`) | `{ url, playable, level, quality, trial }`,试听/受限时带 `restriction` | 已用 |
| `GET /api/song/detail` | 按 id 批量补详情(歌单懒加载窗口用) | `ids`(逗号分隔,≤200) | `song_detail` | 按请求 ids 顺序重排返回 | 已用 |
| `GET /api/lyric` | 取歌词 | `id` | 优先 `lyric_new`(取 `yrc` 逐字歌词),兜底旧版 `lyric` | `{ lyric, tlyric, yrc, source }` | 已用 |
| `GET /api/song/comments` | 歌曲评论 | `id`、`limit`、`offset` | `comment_music` | 首页优先 `hotComments` | 已用 |

## 6. 歌单(`routes/netease.ts`)

| 路由 | 用途 | 关键参数 | NCM 接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/user/playlists` | 我创建/收藏的歌单 | `limit`(12~100) | `user_playlist` | 需登录 | 已用 |
| `GET /api/playlist/tracks` | 歌单曲目(懒加载骨架) | `id` | `playlist_detail`(meta+全量 trackIds)→`song_detail`(补前 100 首详情)→失败兜底 `playlist_track_all`(`limit:500`) | `{ playlist, trackIds, tracks }`,三路上游全失败才报 500,与"真空歌单"区分 | 已用 |
| `POST /api/playlist/create` | 创建歌单 | body `name`、`privacy` | `playlist_create` | 需登录 | 已用 |
| `POST /api/playlist/add-song` | 收藏歌曲到歌单 | body `pid`、`id` | 优先 `playlist_tracks`(`op:'add'`),失败兜底 `playlist_track_add` | 记录两次尝试的 `attempts` | 已用 |

## 7. 收藏 / 红心(`routes/netease.ts`)

| 路由 | 用途 | 关键参数 | NCM 接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/song/like/check` | 查询红心状态 | `ids`(逗号分隔) | 优先直接 `song_like_check`,失败兜底 `likelist`(取全量红心 id 集合再本地比对) | `{ liked: Record<id, boolean> }` | 已用 |
| `POST /api/song/like` | 红心/取消红心 | body `id`、`like` | `like` | 需登录 | 已用 |

## 8. 代理(`routes/netease.ts`)

| 路由 | 用途 | 关键参数 | 说明 | 状态 |
|---|---|---|---|---|
| `GET /api/audio` | 音频流代理(支持 Range) | `url` | 渲染层 `AudioEngine` 播放入口;按 host 区分网易/QQ 的 Referer,按扩展名推断 `Content-Type` | 已用 |
| `GET /api/cover` | 封面图代理(带 CORS,供 canvas 取色) | `url` | `Access-Control-Allow-Origin: *` + `Cross-Origin-Resource-Policy: cross-origin` | 已用 |
| `GET /proxy/cover` | 封面图代理(旧版,无 CORS 头) | `url` | 与 `/api/cover` 功能重叠,疑似历史遗留 | 已用但可能冗余 |

## 9. 播客(DJ 电台,`routes/podcast.ts`,同样走 netease cookie)

| 路由 | 用途 | 关键参数 | NCM 接口 | 返回要点 | 状态 |
|---|---|---|---|---|---|
| `GET /api/podcast/search` | 搜索播客 | `keywords`、`limit` | `cloudsearch`(`type:1009`) | `{ podcasts, total }` | 已用 |
| `GET /api/podcast/hot` | 热门播客 | `limit`、`offset` | `dj_hot` | `{ podcasts, more }` | 已用 |
| `GET /api/podcast/detail` | 播客详情 | `id`/`rid` | `dj_detail` | `{ podcast }` | 已用 |
| `GET /api/podcast/programs` | 播客节目列表 | `id`/`rid`、`limit`、`offset` | `dj_program`(`asc:false`) | `{ radio, programs, more, total }` | 已用 |
| `GET /api/podcast/my` | 我的播客(三个分类概览) | — | `dj_sublist`(收藏)+ `user_audio`(创建)+ `sati_resource_sub_list`/`record_recent_voice`(喜欢的声音) | `{ collections }`,需登录 | 已用 |
| `GET /api/podcast/my/items` | 我的播客分项详情 | `key`(collect/created/liked)、`limit`、`offset` | 同上,额外 `dj_paygift`(付费,当前 `key` 枚举未包含 paid 入口) | `{ items, itemType }` | 已用 |
| `GET /api/podcast/dj-beatmap` | DJ 长音频离线锁拍分析 | `url`、`duration`、`intro` | 非 NCM 接口,`lib/dj-analyzer.ts` 本地音频分析 | `{ map }` | 已用(非上游 API,本地计算) |

---

## 附:未在项目中使用的相关 NCM 接口(仅供后续参考)

`fetchMyPodcastItems` 中的 `dj_paygift`(付费播客,`key==='paid'`)分支已实现,但 `/api/podcast/my` 概览的 `keys` 数组固定为 `['collect', 'created', 'liked']`,不包含 `paid`;仅能通过 `/api/podcast/my/items?key=paid` 单独访问,概览页不展示付费播客分类。

## 参考来源

- 本项目源码:`server/lib/netease-client.ts`、`server/routes/netease.ts`、`server/routes/podcast.ts`
- [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) — 接口参数与返回结构的权威来源
