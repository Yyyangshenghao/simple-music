# 渲染层(`src/`)

React 18 + zustand + motion(framer-motion 后继)+ three.js(@react-three/fiber)。入口 `src/main.tsx` → `App.tsx`。别名 `@renderer/*` → `src/*`。

## App.tsx 装配

`App.tsx` 挂载桥接、登录态、播放、歌词、桌面歌词、壁纸、迷你播放条和氛围色等全局 hooks，并初始化 Provider、播放持久化、Media Session 与更新检查。可视层由 `WindowChrome` 包裹 `AmbientBackground` / `DetailBackdrop` / `TopBar` / `AppShell` / `GlobalContentProviderDock` / `PlayerBar` / `LyricsPanel` / Toast / UpdateBanner；主窗口隐藏、最小化或切到迷你播放条时卸载整棵可视层降耗，但保留全局 hooks 与 AudioEngine。

主题经 `data-theme` 写到 `<html>`，`auto` 模式移除属性交给 CSS 媒体查询。界面、普通歌词和 3D 歌词的中西文字体分别同步到 `--sm-font-sans`、`--sm-lyrics-font-sans` 与 `--sm-lyrics-3d-font-sans`。

大多数页面只在访问时加载，不再启动后集中预热；专辑详情组件随主界面加载，使歌手页和搜索页首次打开专辑时能直接承接封面共享元素转场。其他页面首次挂载等待模块时，转场内部的 Suspense 显示“正在加载页面…”及静态标记，避免空白等待。`LyricsScene` 将 Canvas、Three.js 效果和歌词舞台独立成动态模块，纯歌词及未打开歌词时不加载；`LiquidEther` 也按需加载，等待期间显示静态霞光，背景被详情或 3D 歌词遮住时卸载场景。主题与字体仅在相关设置变化时写根节点样式。

## stores(zustand,单文件单 store)

| store | 职责 |
|---|---|
| `player.ts` | 播放状态/进度/音量/音质；网易/QQ/本地走 `AudioEngine`，Apple Music 走独立 `AppleMusicPlayback` 会话 |
| `playlist.ts` | 播放队列 + 用户歌单/书架(Shelf)数据 |
| `navigation.ts` | 页面路由(`AppView`:explore/library/roam/shuange/settings/release-history + search/artist/artistSongs/toplist/playlist 对象视图)；history/future 双栈上限 50，记录 lastAction 供转场方向；歌手页按历史条目保存标签、搜索词与滚动位置 |
| `settings.ts` | 通用用户设置，localStorage key `simplemusic-settings`；含热键、主题、字体、音质/播放、歌词、迷你条与性能设置 |
| `providers.ts` | 多平台启用、登录态、资料、全局内容平台与播放优先级；平台偏好使用 `simplemusic-provider-settings`，内容平台使用 `simplemusic-content-provider` |
| `visual.ts` | 可视化 FxParams/预设/性能模式;默认值来自 `src/data/default-fx-archive.json` |
| `ambient.ts` | 氛围三色(主/副/点缀),来自封面取色 |
| `lyrics.ts` | 歌词行 + 当前行 tick(由播放进度驱动)+ 3D 歌词布局 |
| `window.ts` | 只读窗口状态,由主进程经 `useDesktopBridge` 推送 |
| `recent.ts` / `likes.ts` | 最近播放持久化、在线平台红心状态与乐观更新 |
| `roam.ts` / `shuange.ts` | 漫游歌手图谱与保存歌单、刷歌会话/自适应推荐状态 |
| `sleep-timer.ts` / `update.ts` | 睡眠定时状态机、应用更新检查/下载任务 |
| `apple-music-connection.ts` / `offline-cache.ts` | Apple Music 登录、订阅及连接状态；网易/QQ 下载队列，三首并发、目录快照、字节进度、暂停、取消和重试，保留最多 100 条终态记录 |

## hooks(全局副作用,大多在 App.tsx 挂载一次)

- `useDesktopBridge` — 订阅窗口状态和迷你条控制，桥接 player/playlist/window store。
- `useShortcuts` — 应用内键盘分发、全局热键注册与事件订阅；录入期间释放全局绑定，丢弃旧注册回复，同键只执行一次。
- `useLoginStatusSync` — 独立核实每个在线平台登录态，并只更新对应 Provider；账号身份变化或卸载后丢弃迟到结果，设置水合及单纯启停平台不使有效检测失效。
- `useAudio` — 播放进度 → lyrics store tick；MusicKit 仅播放时启动 50ms 连续时钟，暂停、拖动及歌词偏移变化即时同步。歌词行用二分定位，同值不通知订阅者。
- `useLyricsFetch` — 换歌时拉歌词。网易逐字主歌词优先使用同时间轴的 `yromalrc` 音译，缺行或不可用时只补入时间匹配的旧 `romalrc`；普通 LRC 主歌词仍使用旧音译时间轴。
- `useDesktopLyricsSync` / `useWallpaperSync` / `useMiniPlayerSync` — 把当前歌词、可视化与播放状态经 IPC 推给三个悬浮窗。
- `useAmbientPalette` — 封面取色(`lib/extract-color.ts`)→ ambient store → `--ambient-1/2/3` CSS 变量；普通页面切换不重复采样，退出刷歌时恢复取色，切歌或卸载时取消旧结果与补间。
- `useAudioEnergy` — AnalyserNode 频谱 → rAF 写 `--audio-energy` 变量(驱动 PlayerGlass 等辉光)。
- `useContentProvider` — 解析探索与我的库共用的全局内容平台；`serviceFor(entity.source)` 按实体复合身份取对应 service，全源搜索等聚合场景经 `ContentHub` 隔离参与平台。
- `useScrollGradient` / `useScrollReveal` — 滚动渐隐边缘 / 入场 stagger。

## providers / lib

快捷键设置位于「设置 → 快捷键」，支持播放/暂停、切歌、音量、喜欢、桌面歌词、迷你模式与打开设置的应用内和全局绑定。点击录入，Esc 取消，Delete/Backspace 或行内清除按钮取消绑定；修改即时保存，启动恢复。录入期间暂停应用菜单快捷键；刷新、退出等菜单组合及常见系统保留键不能绑定。打开设置默认是 macOS `⌘+,` / Windows `Ctrl+,`，默认不注册全局键；同步到原生设置菜单，输入框内也可使用。旧存档补上此入口，自定义或清除此项会保留。默认用 `CommandOrControl` 适配 macOS / Windows，全局组合增加 Alt 与 Shift；迷你模式应用内为 `CommandOrControl+Shift+P`。系统和其他软件的自定义占用由注册结果提示。完整的旧默认配置会升级，自定义与主动清除的配置保留。输入框、可编辑区与输入法组合输入期间避让应用内动作。

主窗口阻止 Tab / Shift+Tab 遍历控件及非输入区的普通方向键导航。非输入区的空格优先使用配置的播放快捷键，不触发聚焦按钮、展开标题或多选区域；清除空格绑定后也不激活控件。输入框、可编辑区、原生选择器与滑块保留键盘操作，录入快捷键时不拦截。爽歌页保留上下方向键切换，系统组合和带修饰键的播放快捷键仍按原配置处理。

系统媒体键开关控制网易云、QQ 和本地播放的 Media Session；关闭时保留空处理器，防止浏览器默认媒体动作继续控制音频。Apple Music 官网会话独立管理媒体键，本开关不控制它；应用内与全局快捷键仍复用 player/playlist store 控制 Apple 播放。全局注册失败逐行显示原因，不猜测占用它的软件。

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
- `provider-request-cache.ts` — 相同平台/数据面的在途请求合并，成功缓存最多 64 条；默认 15 秒，浏览内容 5 分钟、最近播放 30 秒，账号或启用状态变化后失效；支持返回首帧同步读取。
- `toplist-cache.ts` — 榜单预览最多 4 个并发请求、200 条缓存，分组缓存 5 分钟、预览缓存 10 分钟；可视卡片优先请求。
- `motion-presets.ts` / `animation.ts` — 全项目动效预设;新动效必须引用而非自写参数。
- `extract-color.ts` / `audio-energy.ts` — 取色与能量计算纯函数(均有测试)。

## components / pages

主窗口滚动条由 `styles/global.css` 统一定制，尺寸与普通、悬停、拖动颜色复用 `--sm-scrollbar-*` token；页面、弹窗、队列和横向列表跟随深浅主题，歌词固定深色浮层局部覆盖颜色。外层、轨道与轨道片段均显式透明，滑块使用低透明度中性色，悬停和拖动逐级加深，避免滚动条底色与氛围背景断开。`ScrollArea` 复用同一滚动条，保留滚动引用、共享布局动画及吸顶回调；不再单独测量或绘制滑块。悬停或滚动时显示，停止滚动 800ms 且鼠标离开后收起；`useScrollbarActivity` 捕获内层滚动并按容器独立计时，卸载时清理。歌词正文和轮播等原本隐藏滚动条的区域保持隐藏。

歌单和专辑详情的上下渐变遮罩位于滚动视口外，覆盖包括滚动条占位在内的完整宽度，避免封面背景在右侧露出亮边；遮罩不接收鼠标事件，滚动引用与虚拟列表仍绑定内部视口。

播放栏右下角「…」打开 `Player/MoreMenu` 播放设置面板：游戏模式入口位于顶部，开启后后台播放，可从托盘返回。面板固定标题与关闭入口，内容区独立滚动；来源以图标和名称展示一次，音质按网格排列，倍速等宽分段，定时关闭支持播完当前曲再停。

设置页的音源与账户列表为各平台提供登录入口：网易云与 QQ 复用头像菜单的原生登录窗口和 Cookie 交换流程，取消不改账号状态，失败显示提示。Apple Music 的登录、退出与取消授权保留在音源行，订阅要求及连接状态说明收进 i 浮层。

「关于应用」保留版本信息、检查更新及安装入口；更新历史通过「更新日志」按钮进入按需加载的 `ReleaseHistoryPage`（`release-history` 视图），返回时恢复设置的关于应用区域。页面复用 `Update/ReleaseHistory` 展示离线更新历史，`lib/release-history.ts` 通过 Vite raw glob 打包 `docs/release-notes-*.md`，按版本倒序过滤当前及更早版本。摘要解析为类别与描述，并兼容旧条目的可选标题，按新增/优化/修复/说明分组，版本标题显示各类别数量，空类别不展示。当前版本默认展开，历史版本使用原生 `details/summary` 支持鼠标和键盘展开；只读取更新日志（兼容旧「主要变化」标题）与兼容说明，不展示开发验收记录。尚未取得更新检查结果时，版本号使用 `package.json` 的应用版本。

顶栏 `TopBar` 使用常驻宽搜索栏（220～320px 自适应），聚焦不改变宽度；窄窗口让导航参与布局，避免挤占搜索及窗口按钮。空搜索通过可选 `catalog.getSearchHotkeys()` 展示当前内容平台的热词（网易云、QQ 均已接入），要求该平台已登录且已启用，不混入另一平台热搜。`SearchHotkeys` 点击填词后复用原跨平台防抖搜索，关闭、切平台或禁用时丢弃在途热词响应。下拉层使用实色背景打底，避免页面文字透入。

空搜索同时展示本地搜索历史，复用 `lib/search-history.ts` 的去重、置顶与最多 10 条存储，以自动换行的圆角气泡展示，长词省略；气泡悬停或键盘聚焦时显示删除按钮。明确提交搜索或选择歌曲/歌手后记录关键词，输入过程不记录；历史可再次搜索、单条删除或清空。歌手简介使用纯文本的 `details/summary` 展开，缺少简介时隐藏入口。歌手页资料、热门歌曲预览、专辑和相似歌手复用最多 5 分钟的浏览缓存，返回首帧直接显示已有数据，再于绘制前恢复滚动位置；缓存未命中时仍等待当前标签数据，用户主动滚动会取消恢复。探索推荐与个人栏目也同步读取缓存，推荐牌堆每个平台只保留最近一份，并以有效缓存对象校验；页面往返使用短距离淡入淡出，探索/库详情由宿主的路由快照驱动，退出中的页面不重建列表。背景仅由当前活动详情申请，封面与遮罩一起淡出。

播放队列 `QueuePanel` 底部的 `QueueDiscovery` 提供 QQ“发现相似音乐”：当前曲目具备有效数字 `qqId`、QQ 已登录且启用时可见，展开后才调用可选 `catalog.getSimilarTracks()` / `getRelatedPlaylists()`。歌曲仅追加并防重复，不打断播放；歌单可换批或打开详情。切歌恢复收起，关闭/禁用后丢弃旧响应，两类推荐独立失败；歌单换批失败保留原列表并提供重试。Esc 关闭时仅在焦点仍位于队列内的情况下返回队列按钮，不抢走外部焦点。

`SearchPage` 按歌曲、歌手、专辑和歌单独立搜索，支持来源及类别筛选；账号或参与平台变化后丢弃旧结果。歌曲、专辑与歌单结果标题右侧统一使用“更多”菜单，整批追加队列、批量下载和进入多选复用 `BatchTrackActions`；进入多选后才显示勾选框与吸顶操作栏，与歌单详情保持一致。`useMultiSelection` 统一处理鼠标框选、边缘自动滚动、Shift 连选、⌘/Ctrl+A 与 Esc；详情按完整虚拟行坐标选中未挂载曲目，搜索或账号变化清空旧选区。多选中隐藏单曲红心与下载按钮，卡片暂停倾斜以保持稳定选区。`BatchTrackActions` 按显示顺序展开专辑/歌单、按来源和 ID 去重，追加队列而不打断当前播放。批量操作提供追加播放队列和下载，不提供写入平台歌单的入口；应用聚合歌单归属 2.4.0，范围见 [聚合歌单概念记录](../specs/2026-10-06-aggregate-playlists-2.4.0.md)。网易/QQ 歌曲、专辑和歌单支持批量下载，歌单占位曲目在任务开始时补全详情，Apple Music 不进入普通下载。专辑/歌单详情将整批追加队列、批量下载与进入多选收进标题旁的“更多”菜单，进入多选后才显示吸顶操作栏；菜单支持箭头、Home/End、Esc、外部点击及焦点离开关闭，处理中可重新展开取消；专辑曲目行隐藏封面，详情封面最大 240px，窄窗口自适应。

顶栏 `DownloadQueue` 常驻下载入口，显示进度、等待及终态记录，支持暂停开始新任务、取消、重试和目录管理；关闭面板不停止下载，队列在当前运行期间保留。首次下载目录沿用旧缓存配置，再独立保存；改下载目录只影响新任务，完整缓存可直接导出为可读文件名和真实音频扩展名。设置将歌曲下载和播放器离线音频分别展示，清理缓存不删除导出文件。

页面:`ExplorePage`(当前内容平台的原生推荐)、`LibraryPage`(在线歌单/收藏、最近播放、离线音乐、本地音乐)、`RoamPage`、`ShuangePage`、`ToplistPage`、`AppleChartPage`、`ArtistPage`、`ArtistSongsPage`、`SearchPage`、`SettingsPage` 与 `ReleaseHistoryPage`。`GlobalContentProviderDock` 在布局层统一控制探索与我的库。离线音乐独立于在线平台登录态，支持按标题、艺人或专辑搜索、按保存时间/标题/艺人排序、播放当前筛选列表与逐曲移除保存；移除只取消固定，文件保留为临时缓存。“更多”菜单提供追加队列和进入多选，复用框选、Shift 连选、全选、Esc 退出与吸顶操作栏；离线网易/QQ 追加队列无需登录，不改变当前播放。批量删除先确认，按所选保存快照逐项删除；共享音频保留其他离线歌曲，独立导出文件保留。取消、选区变化或退出多选停止后续请求，完成后回查列表，失败项保留供重试。组件按域分目录:`Layout/`(WindowChrome、TopBar、AppShell 转场与背景层)、`Player/`、`Lyrics/`(LyricsPanel、StageLyrics 3D 舞台、KtvLine 逐字、DesktopLyrics)、`Explore/`、`Playlist/`、`Roam/`、`Shuange/`、`Search/`、`Shelf/`、`Visualizer/`、`Update/`、`ui/`。

样式:CSS Modules 与组件同目录;设计 token 全部在 `src/styles/tokens.css`(`--sm-*` 基础、`--glass-*` 玻璃层级、`--ambient-*` 氛围色、`--audio-energy`)；氛围色与音频能量变量经 `@property` 注册，其余使用普通 CSS 自定义属性。`reduce-transparency` 开关(见 settings store)经 `App.tsx` 写 `data-reduce-transparency` 属性,tokens.css 内对应分支把玻璃 blur 降为纯色底、流体背景退化为静态霞光。

我的库的本地、离线和最近播放列表复用 `VirtualList`，仅渲染可视区及 overscan；曲目行固定 56px，库列表步长为 58px（含 2px 间距）。筛选、排序与播放队列派生值复用，点击下标始终对应完整筛选结果。播放进度订阅集中在滑轨子组件，音量订阅集中在音量组，避免频繁唤醒封面、队列和菜单。播放持久化只缓存当前不可变队列与随机顺序的序列化结果，保持原 schema、断点恢复及配额不足的占位降级。

导航、歌单卡片与播放控件统一间距和焦点轮廓，深浅主题沿用封面取色。设置页宽屏侧栏参与布局，1280px 及以下切为横向导航，避免展开导航遮挡内容。歌词页将桌面、普通与 3D 歌词的中文/西文字体集中为独立分组；3D 舞台开关独立成行，关闭时详细设置仍显示但原生禁用并置灰，字体选择保持可用。性能验收与维护边界见 [性能与界面维护](../performance.md)。

## 注意事项

- 封面共享元素转场依赖 layoutId 约定：专辑统一 `album-cover-${source}-${String(id)}`，普通歌单沿用 `explore-cover-*` / `library-cover-*`；滚动容器使用 `layoutScroll`，AppShell 统一 `LayoutGroup`。
- 全屏 WebGL(LiquidEther / Visualizer Scene)同屏只跑一个。
- 异步加载要用会话计数 ref 丢弃过期响应(参考 `ProviderRecommendationSection.sessionRef`)。
- `Track.duration` 单位是毫秒(见根 CLAUDE.md 关键约定)。
- 在线平台只接受 `ProviderId`(`netease`/`qq`/`apple`)，本地音乐是 `MusicSource` 的第四种值；新增分支不能把 `local` 落进网易兜底。Apple Music 受保护音频不进入普通跨源直链或离线缓存，歌词匹配是独立流程。
