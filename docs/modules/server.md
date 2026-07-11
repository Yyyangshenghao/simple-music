# API Server(`server/`)

原生 `node:http` 实现的本地 API server,监听 `127.0.0.1` 随机端口(独立运行时默认 35530)。正常由主进程 `electron/server-host.ts` 内嵌启动并注入 `userDataDir`(cookie 等持久化位置);也可 `npm run server:dev` 独立跑,配合渲染层非 Electron 回退调试。

## 路由机制

`server/index.ts` 维护 `RouteHandler` 链(签名见 `server/types.ts`):handler 返回 `true` 表示已处理,`false` 继续匹配;`static.ts` 兜底放最后(prod 下伺服 out/ 静态文件)。CORS 全放行(dev 跨端口、prod file:// origin 为 null)。新增端点:在对应 `routes/*.ts` 加分支,或新建 route 文件后加入 `chain`。

## 路由与端点

- **`routes/netease.ts`**(网易云,依赖 `NeteaseCloudMusicApi` 包,`lib/netease-client.ts` 封装 + cookie 管理):
  - 登录:`/api/login/qr/{key,create,check}`、`/api/login/cookie`、`/api/login/status`、`/api/logout`
  - 内容:`/api/discover/home`、`/api/netease/recommend/{playlists,songs}`、`/api/netease/radar`(固定歌单 id 3136952023 + 登录 cookie)、`/api/netease/banner`、`/api/netease/artist/{detail,songs,albums}`
  - 通用(带 source 参数分流或网易默认):`/api/search`、`/api/search/artists`、`/api/song/url`、`/api/lyric`、`/api/playlist/tracks`、`/api/user/playlists`、`/api/playlist/{create,add-song}`、`/api/song/{like,like/check,comments}`、`/api/artist/detail`
  - 代理:`/api/audio`(音频流代理,渲染层 AudioEngine 播放入口)、`/api/cover`(封面图代理)
- **`routes/qq-music.ts`**(`lib/qq-client.ts`,自参考项目移植的上游请求封装):`/api/qq/{search,song/url,lyric,playlist/tracks,user/playlists,artist/detail,song/comments,login/*,logout}`
- **`routes/podcast.ts`**:`/api/podcast/{hot,search,detail,programs,my,my/items,dj-beatmap}`;DJ 节目锁拍分析在 `lib/dj-analyzer.ts`(离线分析,自参考项目移植)
- **`routes/beatmap.ts`** + `lib/beatmap.ts`:`/api/beatmap/cache{,/status}`,节拍图缓存
- **`routes/weather.ts`** + `lib/weather.ts`:`/api/weather/{ip-location,radio}`(Open-Meteo + IP 定位 + 天气电台)
- **`routes/update.ts`** + `lib/update.ts`:`/api/app/version`、`/api/update/{latest,download,download/status,patch,patch/status}`;更新源配置在 package.json 的 `simplemusic.update` 字段(GitHub Release + 国内镜像列表)

## lib 辅助

`http.ts`(sendJson/sendError 等,有测试)、`cookie.ts`(cookie 序列化/解析,有测试)。

## 约定

- Track/Playlist 的字段映射(`mapSongRecord`/`mapDiscoverPlaylist` 等)在 `lib/netease-client.ts`,是 `src/types/domain.ts` 领域类型的事实来源;改返回结构时两边同步。
- `Track.duration` 统一映射为毫秒(网易 `dt` 原样,QQ `interval×1000`)。
- qq-client / dj-analyzer / update / weather 均标注"忠实移植自参考项目",行为对齐优先,重构前先确认上游语义。
