# API Server(`server/`)

原生 `node:http` 实现的本地 API server,监听 `127.0.0.1` 随机端口(独立运行时默认 35530)。正常由主进程 `electron/server-host.ts` 内嵌启动并注入 `userDataDir`(cookie 等持久化位置);也可 `npm run server:dev` 独立跑,配合渲染层非 Electron 回退调试。

## 路由机制

`server/index.ts` 维护 `RouteHandler` 链(签名见 `server/types.ts`):handler 返回 `true` 表示已处理,`false` 继续匹配;`static.ts` 兜底放最后(prod 下伺服 out/ 静态文件)。新增端点:在对应 `routes/*.ts` 加分支,或新建 route 文件后加入 `chain`。

## 安全边界(`lib/security.ts`)

只监听 `127.0.0.1` **不等于**只有本应用能访问 —— 用户浏览器里的任意网页也在本机,端口随机但从 JS 扫一遍临时端口段是秒级的事。两道防护都在这里,新增端点/代理时别绕过:

- **`isAllowedOrigin`(入口统一拦截)**:响应带 `Access-Control-Allow-Origin: *`,若不校验来源,恶意网页可 fetch `/api/local/scan` 扫全盘、经 `/api/local/tracks` 拿到音乐文件绝对路径再从 `/api/local/audio` 流走。现按 `Origin` 头拒绝非渲染层来源(放行:无 Origin、`null`(prod file://)、localhost/127.0.0.1(dev vite)),预检一并挡掉。
- **`isSafeUpstreamUrl`(所有对外代理必须调用)**:代理端点若原样 fetch 调用方给的 url 就是一个开放代理,可被用来读内网/回环服务(SSRF)。`/api/audio`、`/api/cover`、`/proxy/cover`、`/api/podcast/dj-beatmap` 均已限定 http(s) 且非本机/内网网段。
- 已知残留:主机名黑名单挡不住 DNS rebinding。彻底修需在连接建立后校验对端 IP,代价远高于收益(上游只会是音乐平台 CDN)。

## 路由与端点

- **`routes/netease.ts`**(网易云,依赖 `NeteaseCloudMusicApi` 包,`lib/netease-client.ts` 封装 + cookie 管理):
  - 登录:`/api/login/qr/{key,create,check}`、`/api/login/cookie`、`/api/login/status`、`/api/logout`
  - 内容:`/api/discover/home`、`/api/netease/recommend/{playlists,songs}`、`/api/netease/radar`(固定歌单 id 3136952023 + 登录 cookie)、`/api/netease/banner`、`/api/netease/artist/{detail,songs,albums}`、`/api/netease/album/songs`(专辑曲目全量)
  - 通用(带 source 参数分流或网易默认):`/api/search`、`/api/search/artists`、`/api/song/url`、`/api/lyric`、`/api/playlist/tracks`、`/api/user/playlists`、`/api/playlist/{create,add-song}`、`/api/song/{like,like/check,comments}`、`/api/artist/detail`
  - 代理:`/api/audio`(音频流代理,渲染层 AudioEngine 播放入口;可选 `cacheKey=source:id:quality` 参数触发磁盘缓存,见 `lib/audio-cache.ts`)、`/api/cover`(封面图代理)
  - 音频缓存管理:`/api/audio-cache/{stats,clear,config}`(整流下载落盘,默认 userDataDir/audio-cache + 2GB LRU;目录与上限可经 config 端点读写,持久化在 userDataDir/audio-cache-config.json;拖进度条的中段 Range 只透传不落盘)
- **`routes/qq-music.ts`**(`lib/qq-client.ts`,自参考项目移植的上游请求封装):`/api/qq/{search,song/url,lyric,playlist/tracks,user/playlists,artist/detail,artist/albums,album/songs,song/comments,login/*,logout}`
- **`routes/podcast.ts`**:`/api/podcast/{hot,search,detail,programs,my,my/items,dj-beatmap}`;DJ 节目锁拍分析在 `lib/dj-analyzer.ts`(离线分析,自参考项目移植)
- **`routes/local-music.ts`** + `lib/local-library.ts`:`/api/local/{tracks,scan,remove-folder,audio,cover,lyric}`;扫描用户选定文件夹、`music-metadata` 解析内嵌标签与封面,索引持久化在 userDataDir/local-library.json
- **`routes/beatmap.ts`** + `lib/beatmap.ts`:`/api/beatmap/cache{,/status}`,节拍图缓存
- **`routes/weather.ts`** + `lib/weather.ts`:`/api/weather/{ip-location,radio}`(Open-Meteo + IP 定位 + 天气电台)
- **`routes/update.ts`** + `lib/update.ts`:`/api/app/version`、`/api/update/{latest,download,download/status,patch,patch/status}`;更新源配置在 package.json 的 `simplemusic.update` 字段(GitHub Release + 国内镜像列表)

## lib 辅助

`http.ts`(sendJson/sendError 等,有测试)、`cookie.ts`(cookie 序列化/解析,有测试)、`audio-cache.ts`(音频磁盘缓存:Range 解析/整流判定/LRU,有测试)、`security.ts`(来源校验 + 代理上游校验,有测试)、`local-library.ts`(本地音乐索引;音频/封面/歌词一律按索引 id 反查路径,不接受调用方直传路径)。

## 约定

- Track/Playlist 的字段映射(`mapSongRecord`/`mapDiscoverPlaylist` 等)在 `lib/netease-client.ts`,是 `src/types/domain.ts` 领域类型的事实来源;改返回结构时两边同步。
- `Track.duration` 统一映射为毫秒(网易 `dt` 原样,QQ `interval×1000`)。
- qq-client / dj-analyzer / update / weather 均标注"忠实移植自参考项目",行为对齐优先,重构前先确认上游语义。
