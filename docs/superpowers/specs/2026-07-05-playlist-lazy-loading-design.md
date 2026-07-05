# 歌单懒加载 + 虚拟列表设计

日期:2026-07-05
状态:已确认设计,待实现

## 背景与问题

- 网易歌单曲目接口 `/api/playlist/tracks`(server/routes/netease.ts)一次性调 `playlist_track_all`,写死 `limit: 500, offset: 0`:
  1. 超过 500 首的歌单被截断;
  2. 一次拉 500 首上游响应很慢,进详情页要等全量返回。
- 渲染层(LibraryPage / ExplorePage 详情、PlaylistPreviewModal)先等全部 tracks 到手才进详情,列表全量 `.map` 渲染无虚拟化,大歌单渲染卡顿;`AnimatedTrackRow` 入场 delay 按绝对索引 `i*0.05` 计算,第 600 行要等 30 秒。
- QQ 侧 `fcg_ucc_getcdinfo` 一次返回完整 songlist,无 500 截断,本次不改其抓取逻辑。

## 关键技术事实(设计依据)

- 网易 `playlist_detail` 可一次拿到歌单 meta + **完整 trackIds 列表**(快,不受 500 限制),只缺每首歌的详情。
- `song_detail` 支持按 id 批量补详情,NeteaseCloudMusicApi 4.32 已导出该接口。
- 播放 URL 的获取(`/api/song/url`)只需要 `track.id`(QQ 需 mid,但 QQ 无占位场景),因此"只有 id 的占位曲目"也可播放。

## 已确认的方案选择

- **加载模型:全骨架 + 按需填充。** 先拿全量 trackIds,总数/滚动条/任意位置跳转从第一刻就是准的;详情按视口窗口懒补,未加载行显示骨架占位。
- **播放全部:按 id 全量入队。** 队列直接是完整曲目顺序,pending 曲目播到/切到时再补详情;随机播放覆盖全部曲目。
- **虚拟滚动:一起做。** 自写轻量 VirtualList,不新增依赖。

## 设计

### 1. Server 层(只动网易)

- `/api/playlist/tracks` 改造:
  - 先 `playlist_detail` 取 meta(name/cover/trackCount)+ 全量 `trackIds`;
  - 再 `song_detail` 补前 100 首详情;
  - 响应结构:`{ playlist, trackIds: string[], tracks: Track[] }`。
  - `playlist_track_all` 保留为 fallback(playlist_detail 不可用时,行为退化为旧逻辑)。
- 新增 `/api/song/detail?ids=a,b,c`:按 id 批量补详情(单批上限 200),复用现有 `mapSongRecord` 映射,响应 `{ tracks: Track[] }`。

### 2. MusicService 接口(src/lib/music-service.ts)

```ts
interface PlaylistSkeleton {
  playlist: Playlist
  trackIds: unknown[]
  tracks: Track[]   // 已填充详情的前缀批次
}
getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton>   // 取代 getPlaylistDetail
getTracksByIds(ids: unknown[]): Promise<Track[]>
```

- 网易实现:走上面两个端点。
- QQ 实现:skeleton 直接全量返回(trackIds=全部、tracks=全部),`getTracksByIds` 直连不会有未命中场景;调用方逻辑对两个音源统一,无分支。
- 迁移调用方:LibraryPage.openPlaylist、PlaylistPreviewModal;`getPlaylistDetail` 移除。

### 3. 渲染层懒加载状态

- 新 hook `useLazyPlaylist(playlist, initialTracks?)`:
  - 内部稀疏数组 `(Track | null)[]`,长度 = trackIds.length;
  - 按 100 首一窗,视口滚到哪补哪(由 VirtualList 的 onRangeChange 驱动);
  - 竞态守卫沿用 ExplorePage 的 `loadSession` 计数 ref 模式,切歌单/音源时丢弃在途响应;
  - 窗口级请求去重;窗口失败标记可重试(再次滚到时重新触发),不阻塞其他窗口;
  - 按歌单 id 做模块级缓存,顶栏后退/前进再进入不重拉。
- `Track` 增加可选 `pending?: boolean`;占位曲目形如 `{ id, provider, source, type: 'song', name: '', artist: '', artists: [], pending: true }`。
- 窗口计算/去重/竞态核心逻辑抽为纯函数模块(仿 `stack-pool.ts` 的模式),便于单测。

### 4. 虚拟列表 VirtualList(不加依赖)

- 自写轻量组件:固定行高,只渲染可视区 ± overscan;总高度 = 行高 × 总曲目数,**滚动条一开始就等于完整长度,可直接拖到任意位置**。
- 暴露 `onRangeChange(start, end)` 回调,驱动懒加载窗口。
- 未加载行渲染骨架占位(shimmer 用现有 tokens.css 变量,不写魔法数值)。
- LibraryPage 与 ExplorePage 的详情 JSX 高度重复,抽为共用 `PlaylistDetailView` 组件,VirtualList 只落一处;PreviewModal 曲目列表同样受益。
- 虚拟列表中的行随滚动反复挂载/卸载,逐行入场动画会造成滚动闪动:详情页改为直接用 `TrackRow`(列表容器保留 fadeRise 入场),`AnimatedTrackRow` 迁移后无使用方,删除。

### 5. 队列与播放

- "播放全部"按完整 trackIds 入队(未加载详情的为占位曲目)。
- playlist store 的 `playAt/next/prev` 遇到 `pending` 曲目:先按 id 调 `getTracksByIds` 补详情并回填队列,再 `loadTrack`;若补详情失败,网易仍凭 id 直接取播放 URL 兜底播放(暂缺歌名等展示信息)。
- store 内不能用 hook,直接 import netease/qq service 单例,按 `track.source` 选取。
- QueuePanel 中 pending 行显示骨架占位。

### 6. 导航 store

- `{ type: 'playlist', playlist, tracks }` 中 `tracks` 变为可选初始数据:
  - 每日推荐/私人雷达仍直接传全量 tracks(数据已在手,不走懒加载);
  - 普通歌单入口只传 playlist,详情视图自行懒加载。

### 7. 错误处理

- skeleton 请求失败:详情页显示错误态,可重试。
- 窗口详情请求失败:该窗口可重试,不影响已加载窗口。
- 音源切换/快速导航:loadSession 守卫丢弃过期响应。

### 8. 测试与验证

- vitest:懒加载窗口计算、请求去重、竞态丢弃的纯函数测试;VirtualList 可视范围计算的纯函数测试。
- `npm run typecheck` + `npm test` 全过。
- Electron playwright 实测:打开 500+ 首的真实歌单,验证总数正确、拖动滚动条到尾部触发加载、跳播未加载曲目可播。

## 明确不做(YAGNI)

- 不改 QQ 侧抓取(本来就全量返回)。
- 不做歌单内搜索/排序等新功能。
- 不为每日推荐/雷达引入懒加载(数据量小且已全量)。
