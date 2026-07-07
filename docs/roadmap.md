# 功能路线图

> 2026-07-07 基于功能面盘点得出。按优先级从上往下做,每项做完勾掉并补一行实际落地说明。
> 验证标准统一:`npm run typecheck` + `npm test` 通过,涉及播放行为的跑 dev 实测。

## P0 — 播放器基本功(下一轮进入)

### 1. 播放模式:顺序 / 单曲循环 / 随机

- [x] 已完成:playMode 落 settings 持久化;playlist store `stepIndex` 按模式走序(随机=洗牌排列可回溯);player `ended` 经注册回调接入(顺带修复自然播完不自动切歌);PlayerBar 加模式按钮。
- ~~现状:`src/stores/playlist.ts` 的 `next()/prev()` 只有顺序循环取模,无模式概念;PlayerBar 无切换按钮。~~
- 要点:
  - playlist store 加 `playMode: 'order' | 'one' | 'shuffle'`,`next()`(含自然播完触发)按模式取下一首;随机建议洗牌序列而非纯随机,保证 prev 可回溯、不重复。
  - `AudioEngine` 的 `ended` 回调链按模式分流(单曲循环直接 seek 0 重播,不走 next)。
  - PlayerBar 加模式切换按钮,动效用 `motion-presets`,图标随模式切换。
  - 模式持久化进 settings(localStorage `simplemusic-settings`)。
- 完成标准:三种模式切换即时生效;自然播完与手动下一首行为一致;重启后模式保留。

### 2. 播放状态持久化(重启恢复)

- [x] 已完成:`src/lib/playback-persistence.ts` 落 `simplemusic-playback`(队列剥 URL,超配额降级占位);恢复为暂停态,`player.play()` 检测引擎无源按断点重载(engine `load(url, startAt)` 元数据就绪后 seek);进度 5s 节流 + 暂停/切队列/beforeunload 落盘。
- ~~现状:队列、当前曲目、进度、音量均不落盘,重启全丢。~~
- 要点:
  - 新 localStorage key(如 `simplemusic-playback`):queue(Track 序列化)+ queueIndex + 进度 + volume。
  - 写入节流(如进度每 5s / 暂停时写);启动时恢复为**暂停态**,不自动播放。
  - 恢复的 Track 可能过期 → 播放时照常走 `getTrackUrl` 兜底;跨音源恢复注意 `serviceFor(track.source)`。
  - pending 占位曲目(懒加载队列)只存 id + source,恢复后按需补详情。
- 完成标准:重启后队列/当前曲/进度/音量原样恢复,点播放从断点继续。

### 3. 系统媒体集成(Media Session)

- [x] 已完成:`src/lib/media-session.ts` 挂 metadata + play/pause/next/prev/seekto handler,`setPositionState` 1s 节流同步;App 启动初始化。注意:用户若在热键设置里显式绑定媒体键(globalShortcut)会抢占系统路由,属预期。
- ~~现状:全项目无 `navigator.mediaSession`。~~
- 要点:
  - 渲染层挂 `navigator.mediaSession`:metadata(标题/歌手/封面)+ play/pause/next/prev/seek handler,接 player/playlist store。
  - `setPositionState` 同步进度;切曲/暂停时更新 playbackState。
  - 注意与现有全局热键不冲突(热键走 IPC,mediaSession 走系统)。
- 完成标准:控制中心显示曲目信息,键盘媒体键与耳机线控可控制播放。

## P1 — 补齐"我的库"占位

### 4. 最近播放(本地记录)

- [x] 已完成:`src/stores/recent.ts` 订阅 player(currentTrack+loading 置入时记录,恢复态不记),200 条去重落 localStorage;Library tab 列表复用 TrackRow,点击整单入队从该曲播起,附清空按钮。
- ~~现状:"最近播放" tab 占位。~~
- 要点:本地 localStorage 记录(track + 播放时间,上限 ~200 条去重),播放时写入;不依赖登录、跨音源可用;tab 内列表复用 `TrackRow`。
- 完成标准:播放过的歌按时间倒序出现在 tab 中,点击可重播;重启保留。

### 5. 收藏 tab 接通

- [x] 已完成:`MusicService` 加可选 `likeTrack/checkLiked/getLikedPlaylist`(网易实现,QQ 自动隐藏);`likes` store 乐观更新失败回滚;PlayerBar 红心按钮;收藏 tab 显示"我喜欢的音乐"卡片进懒加载详情。TrackRow 逐行红心暂未做(交互密度待定)。
- ~~现状:tab 占位。~~
- 要点:
  - `MusicService` 加可选方法(likeTrack / getLikedTracks),网易先行,QQ 未实现则隐藏入口(沿用每日推荐的可选方法模式)。
  - PlayerBar / TrackRow 加红心按钮;收藏 tab 即"我喜欢的音乐"歌单(网易首个自建歌单),复用 `PlaylistDetailView` 懒加载。
- 完成标准:登录网易后可红心/取消,收藏 tab 展示喜欢列表并可播放。

## P2 — 延后(明确本轮不做)

- **睡眠定时**:定时暂停/淡出,纯渲染层,成本低但非刚需。
- **托盘常驻 / 关闭最小化**:`electron/modules/` 加 tray-manager;与 window-manager 关闭行为联动。
- **本地缓存 / 下载**:涉及存储管理、缓存淘汰、音源版权形态差异,工程量大,等 P0/P1 稳定后单独立项设计。
- **QQ 音源修复**:上游接口不可用(2026-07-05 已知),不可控,恢复后再回归验证。

## 依赖与风险

- P0-1 与 P0-2 都动 playlist store 的队列逻辑,**按序做**(先模式后持久化),避免互相冲突。
- P0-3 独立,可与前两项并行。
- 队列持久化要兼容懒加载 pending 占位曲目(459b4eb 引入),序列化前先确认占位结构。
- 收藏依赖登录态与网易端点,QQ 侧暂不承诺。
