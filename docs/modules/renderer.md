# 渲染层(`src/`)

React 18 + zustand + motion(framer-motion 后继)+ three.js(@react-three/fiber)。入口 `src/main.tsx` → `App.tsx`。别名 `@renderer/*` → `src/*`。

## App.tsx 装配

`App.tsx` 挂载桥接、登录态、播放、歌词、桌面歌词、壁纸、迷你播放条和氛围色等全局 hooks，并初始化 Provider、播放持久化、Media Session 与更新检查。可视层由 `WindowChrome` 包裹 `AmbientBackground` / `DetailBackdrop` / `TopBar` / `AppShell` / `GlobalContentProviderDock` / `PlayerBar` / `LyricsPanel` / Toast / UpdateBanner；主窗口隐藏、最小化或切到迷你播放条时卸载整棵可视层降耗，但保留全局 hooks 与 AudioEngine。

主题经 `data-theme` 写到 `<html>`，`auto` 模式移除属性交给 CSS 媒体查询。界面、普通歌词和 3D 歌词的中西文字体分别同步到 `--sm-font-sans`、`--sm-lyrics-font-sans` 与 `--sm-lyrics-3d-font-sans`。

页面只在访问时加载，不再启动后集中预热。`LyricsScene` 将 Canvas、Three.js 效果和歌词舞台独立成动态模块，纯歌词及未打开歌词时不加载；`LiquidEther` 也按需加载，等待期间显示静态霞光，背景被详情或 3D 歌词遮住时卸载场景。主题与字体仅在相关设置变化时写根节点样式。

## stores(zustand,单文件单 store)

| store | 职责 |
|---|---|
| `player.ts` | 播放状态/进度/音量/音质；网易/QQ/本地走 `AudioEngine`，Apple Music 走独立 `AppleMusicPlayback` 会话 |
| `playlist.ts` | 播放队列 + 用户歌单/书架(Shelf)数据 |
| `navigation.ts` | 页面路由(`AppView`:explore/library/roam/shuange/settings + artist/toplist/playlist 对象视图)；history/future 双栈上限 50，记录 lastAction 供转场方向 |
| `settings.ts` | 通用用户设置，localStorage key `simplemusic-settings`；含热键、主题、字体、音质/播放、歌词、迷你条与性能设置 |
| `providers.ts` | 多平台启用、登录态、资料、全局内容平台与播放优先级；平台偏好使用 `simplemusic-provider-settings`，内容平台使用 `simplemusic-content-provider` |
| `visual.ts` | 可视化 FxParams/预设/性能模式;默认值来自 `src/data/default-fx-archive.json` |
| `ambient.ts` | 氛围三色(主/副/点缀),来自封面取色 |
| `lyrics.ts` | 歌词行 + 当前行 tick(由播放进度驱动)+ 3D 歌词布局 |
| `window.ts` | 只读窗口状态,由主进程经 `useDesktopBridge` 推送 |
| `recent.ts` / `likes.ts` | 最近播放持久化、在线平台红心状态与乐观更新 |
| `roam.ts` / `shuange.ts` | 漫游歌手图谱与保存歌单、刷歌会话/自适应推荐状态 |
| `sleep-timer.ts` / `update.ts` | 睡眠定时状态机、应用更新检查/下载任务 |
| `apple-music-connection.ts` / `offline-cache.ts` | Apple Music 登录、订阅及连接状态；在线单曲离线保存状态 |

## hooks(全局副作用,大多在 App.tsx 挂载一次)

- `useDesktopBridge` — 订阅窗口状态、热键和迷你条控制，桥接 player/playlist/window store。
- `useLoginStatusSync` — 独立核实每个在线平台登录态，并只更新对应 Provider。
- `useAudio` — 播放进度 → lyrics store tick；MusicKit 仅播放时启动 50ms 连续时钟，暂停、拖动及歌词偏移变化即时同步。歌词行用二分定位，同值不通知订阅者。
- `useLyricsFetch` — 换歌时拉歌词。
- `useDesktopLyricsSync` / `useWallpaperSync` / `useMiniPlayerSync` — 把当前歌词、可视化与播放状态经 IPC 推给三个悬浮窗。
- `useAmbientPalette` — 封面取色(`lib/extract-color.ts`)→ ambient store → `--ambient-1/2/3` CSS 变量；普通页面切换不重复采样，退出刷歌时恢复取色，切歌或卸载时取消旧结果与补间。
- `useAudioEnergy` — AnalyserNode 频谱 → rAF 写 `--audio-energy` 变量(驱动 PlayerGlass 等辉光)。
- `useContentProvider` — 解析探索与我的库共用的全局内容平台；`serviceFor(entity.source)` 按实体复合身份取对应 service，全源搜索等聚合场景经 `ContentHub` 隔离参与平台。
- `useScrollGradient` / `useScrollReveal` — 滚动渐隐边缘 / 入场 stagger。

## providers / lib

- `providers/types.ts` — `MusicProvider` 与 catalog/playback/recommendations/library/history/playlistWriter/toplists 能力契约。
- `providers/registry.ts` — 网易/QQ/Apple Music Provider 注册表；新功能先判断对应 capability 是否存在。`local` 不在该在线注册表中。
- `providers/*-provider.ts` — 平台能力实现；`legacy-provider-adapter.ts` 连接仍使用 `MusicService` 的旧页面。

- `music-service.ts` / `service-registry.ts` — 兼容层接口与 service 单例；实体操作必须 `serviceFor(entity.source)`，不得从当前内容平台猜来源。
- `api.ts` — HTTP 客户端,端口来自 `window.desktop.serverPort`,API token 来自 `window.desktop.serverToken`(统一带进 query,见 server.md 安全边界);非 Electron 环境回退同源(纯前端调试)。
- `audio-engine.ts` — 单例 HTMLAudioElement 走 `/api/audio` 代理 + AnalyserNode 暴露频谱。
- `apple-music-playback.ts` / `apple-audio-spectrum.ts` — Apple Music 播放命令与后台状态同步；按系统权限尝试采集只读音轨供可视化使用，采集失败不阻断播放。
- `playback-resolver.ts` / `track-match.ts` / `track-preload.ts` — 多平台候选解析、保守同曲匹配和相邻曲目预加载。
- `lyric-parser.ts` — LRC/逐字歌词解析。
- `stack-pool.ts` — 探索页 Stack 卡片堆的池子管理(纯函数,有测试)。
- `toplist-cache.ts` — 榜单预览最多 4 个并发请求、200 条缓存，分组缓存 5 分钟、预览缓存 10 分钟；可视卡片优先请求。
- `motion-presets.ts` / `animation.ts` — 全项目动效预设;新动效必须引用而非自写参数。
- `extract-color.ts` / `audio-energy.ts` — 取色与能量计算纯函数(均有测试)。

## components / pages

顶栏 `TopBar` 使用常驻宽搜索栏（220～320px 自适应），聚焦不改变宽度；窄窗口让导航参与布局，避免挤占搜索及窗口按钮。空搜索通过可选 `catalog.getSearchHotkeys()` 展示当前内容平台的热词（网易云、QQ 均已接入），要求该平台已登录且已启用，不混入另一平台热搜。`SearchHotkeys` 点击填词后复用原跨平台防抖搜索，关闭、切平台或禁用时丢弃在途热词响应。下拉层使用实色背景打底，避免页面文字透入。

播放队列 `QueuePanel` 底部的 `QueueDiscovery` 提供 QQ“发现相似音乐”：当前曲目具备有效数字 `qqId`、QQ 已登录且启用时可见，展开后才调用可选 `catalog.getSimilarTracks()` / `getRelatedPlaylists()`。歌曲仅追加并防重复，不打断播放；歌单可换批或打开详情。切歌恢复收起，关闭/禁用后丢弃旧响应，两类推荐独立失败；歌单换批失败保留原列表并提供重试。Esc 关闭时仅在焦点仍位于队列内的情况下返回队列按钮，不抢走外部焦点。

页面:`ExplorePage`(当前内容平台的原生推荐)、`LibraryPage`(在线歌单/收藏、最近播放、离线音乐、本地音乐)、`RoamPage`、`ShuangePage`、`ToplistPage`、`ArtistPage`、`SettingsPage`。`GlobalContentProviderDock` 在布局层统一控制探索与我的库。离线音乐独立于在线平台登录态，支持按标题、艺人或专辑搜索、按保存时间/标题/艺人排序、播放当前筛选列表与逐曲移除保存；移除只取消固定，文件保留为临时缓存。组件按域分目录:`Layout/`(WindowChrome、TopBar、AppShell 转场与背景层)、`Player/`、`Lyrics/`(LyricsPanel、StageLyrics 3D 舞台、KtvLine 逐字、DesktopLyrics)、`Explore/`、`Playlist/`、`Roam/`、`Shuange/`、`Search/`、`Shelf/`、`Visualizer/`、`Update/`、`ui/`。

样式:CSS Modules 与组件同目录;设计 token 全部在 `src/styles/tokens.css`(`--sm-*` 基础、`--glass-*` 玻璃层级、`--ambient-*` 氛围色、`--audio-energy`),经 `@property` 注册可平滑过渡。`reduce-transparency` 开关(见 settings store)经 `App.tsx` 写 `data-reduce-transparency` 属性,tokens.css 内对应分支把玻璃 blur 降为纯色底、流体背景退化为静态霞光。

我的库的本地、离线和最近播放列表复用 `VirtualList`，仅渲染可视区及 overscan；曲目行固定 56px，库列表步长为 58px（含 2px 间距）。筛选、排序与播放队列派生值复用，点击下标始终对应完整筛选结果。播放进度订阅集中在滑轨子组件，音量订阅集中在音量组，避免频繁唤醒封面、队列和菜单。播放持久化只缓存当前不可变队列与随机顺序的序列化结果，保持原 schema、断点恢复及配额不足的占位降级。

导航、歌单卡片与播放控件统一间距和焦点轮廓，深浅主题沿用封面取色。设置页宽屏侧栏参与布局，1280px 及以下切为横向导航，避免展开导航遮挡内容。性能验收与维护边界见 [性能与界面维护](../performance.md)。

## 注意事项

- 封面共享元素转场依赖 layoutId 约定 `explore-cover-*` / `library-cover-*`。
- 全屏 WebGL(LiquidEther / Visualizer Scene)同屏只跑一个。
- 异步加载要用会话计数 ref 丢弃过期响应(参考 `ProviderRecommendationSection.sessionRef`)。
- `Track.duration` 单位是毫秒(见根 CLAUDE.md 关键约定)。
- 在线平台只接受 `ProviderId`(`netease`/`qq`/`apple`)，本地音乐是 `MusicSource` 的第四种值；新增分支不能把 `local` 落进网易兜底。Apple Music 受保护音频不进入普通跨源直链或离线缓存，歌词匹配是独立流程。
