# 播放系统

> 从「点击一首歌」到「扬声器出声」的全链路设计文档：URL 解析、跨音源兜底、音频引擎、
> 代理与磁盘缓存、队列走序、预加载、持久化、睡眠定时器、系统媒体集成。
> 相关代码：`src/stores/player.ts`、`src/stores/playlist.ts`、`src/lib/audio-engine.ts`、
> `src/lib/track-preload.ts`、`src/lib/track-fallback.ts`、`src/lib/playback-persistence.ts`、
> `server/routes/netease.ts`（/api/audio）、`server/lib/audio-cache.ts`。

## 1. 全链路总览

```
用户点击曲目
  → playlist.setQueue(tracks, index) / playAt(index)      # 队列与走序
  → player.loadTrack(track)                               # URL 解析(带会话计数防竞态)
      1. track.url 自带直链？直接用(不缓存,音质未知)
      2. getPreloadedUrl()      # 相邻曲目预加载缓存命中(5min TTL)
      3. resolveSongUrl()       # GET /api/song/url 或 /api/qq/song/url
      4. 都拿不到且开了 crossSourceFallback → findFallbackTrack() 对侧音源搜同曲兜底
      5. 仍无 URL → status=idle + toast(restriction.message 或通用文案)
  → AudioEngine.load(upstreamUrl, startAt, cacheKey)
  → <audio src="/api/audio?url=<上游CDN>&cacheKey=source:id:quality">
      server: 磁盘缓存命中→本地文件服务(含 Range);未命中→透传上游,整流旁路落盘
  → HTMLAudioElement → MediaElementSource → AnalyserNode → GainNode → destination
                                             │(频谱给可视化)   │(0.25s 淡入淡出包络)
  → 自然播完 ended → stopAfterCurrent 闸门(睡眠定时器) 或 playlist.handleTrackEnded()
```

## 2. player store（`src/stores/player.ts`）

单例 zustand store，持有懒创建的 `AudioEngine` 单例（模块级变量，非 state）。

**关键字段**：

| 字段 | 说明 |
|---|---|
| `status` | `idle / loading / playing / paused`，由引擎事件回写 |
| `currentTrack` | UI 展示用元数据；兜底换源时**仍是原曲目**（见 fallbackSource） |
| `position` / `duration` | 秒（注意 `Track.duration` 是毫秒，loadTrack 里 `/1000` 换算） |
| `quality` | 以 settings store 为单一事实来源，经 `subscribe` 回流（`setQuality` 只是转调 settings） |
| `fallbackSource` | 跨音源兜底生效时"实际出声的音源"，正常播放为 null；PlayerBar 用它显示换源角标 |
| `rate` | 播放速度（保留音高），**不持久化**，重启回 1 |

**两处解耦回调**（都是为了避免反向 import 成环）：

- `registerTrackEndedHandler(cb)`：自然播完后的走序由 playlist store 决定（player 不知道队列存在）。playlist.ts 底部注册。
- `setStopAfterCurrent(cb)`：睡眠定时器「播完当前曲再停」的一次性闸门。置位后 `onEnded` 不走 next，改调该回调并自动清除。

**loadTrack 的竞态守卫**：模块级 `loadSession` 计数器，每次 loadTrack 自增并快照。URL 解析、兜底搜索、兜底再解析每个 await 之后都检查 `session !== loadSession` 即丢弃——快速切歌时在途的旧解析结果绝不会覆盖新曲目。这是全项目异步竞态模式的代表实现。

**恢复态起播**：重启后 restorePlayback 只回填元数据（引擎无源）。`play()` 检测 `!eng.hasSource && currentTrack` 时转调 `loadTrack(currentTrack, { startAt: position })` 按断点重新解析加载——URL 有时效，持久化里从不存 URL。

## 3. AudioEngine（`src/lib/audio-engine.ts`）

单个 `HTMLAudioElement` + Web Audio 图。**图结构与顺序是刻意的**：

```
MediaElementSource → AnalyserNode(fftSize 2048) → GainNode → destination
```

- Analyser 在 Gain **之前**：淡入淡出包络不污染频谱读数（暂停淡出时可视化能量仍反映真实音频，而不是被包络拉没）。
- `getFrequencyData()` 复用同一 `Uint8Array`（frequencyBinCount=1024），每帧零分配，供全部可视化读取。
- AudioContext 懒创建（首次 `play()` 时），`suspended` 状态先 resume；无 Web Audio 环境退化为直连播放（无淡变、无频谱）。

**淡入淡出（FADE_SEC = 0.25s，linearRamp）**：

- `load()`：gain 立即归零，出声时经 `playing` 事件淡入 → 切歌永远从静音拉起，无爆音。
- `pause()`：先 ramp 到 0，UI 立即置 `paused`，`setTimeout(250ms)` 后才真正暂停元素。`pauseTimer` 在 `play()`/`load()` 里必须取消——淡出中途恢复播放，元素没暂停不会再发 `playing` 事件，`play()` 里显式拉回 gain。
- 所有 ramp 前 `cancelScheduledValues + setValueAtTime(g.value)`：从当前实际值起步，快速连点不跳变。

**其它细节**：

- `pendingSeek`：断点续播的起始位置存起来，`loadedmetadata` 后才写 `currentTime`（元数据就绪前设置会被浏览器忽略）。
- `setPlaybackRate` 同时设 `defaultPlaybackRate`，换曲加载后倍速仍生效。
- `load()` 只对 `http(s)` URL 包代理；本地/blob URL 原样直用。
- `crossOrigin='anonymous'`：MediaElementSource 读跨域音频需要 CORS（代理端已放行）。

## 4. URL 解析与音质阶梯

`resolveSongUrl(track, quality)`（`src/lib/track-preload.ts`）按音源分流：

- 网易：`GET /api/song/url?id=&quality=`
- QQ：`GET /api/qq/song/url?mid=&quality=&fee=`（QQ 主键是 mid；fee 用于服务端提前判断付费墙）

**服务端音质阶梯**（`server/lib/netease-client.ts`）：请求音质从 `NETEASE_QUALITY_CANDIDATES` 表（jymaster → hires → lossless → exhigh → higher → standard）中定位起点，**逐级降级尝试**直到拿到可播 URL。`normalizeQualityPreference` 容忍多种别名（flac/sq/320/hq…）。

**播放限制分类**（`classifyNeteasePlaybackRestriction`）：全级降完仍无 URL 时，按登录态 + `fee` + `code` + `freeTrialInfo` 归类为结构化的 `PlaybackRestriction`（login_required / trial_only / vip_required / paid_required / copyright_unavailable / url_unavailable），每类带中文 message 和建议 action（login/upgrade/purchase/switch_source）。渲染层 toast 直接用这个 message——**"放不了"时用户看到的是具体原因，不是笼统报错**。

## 5. 跨音源兜底（`src/lib/track-fallback.ts`）

当前音源解析不出 URL（VIP 付费墙/灰色下架）且 `settings.crossSourceFallback` 开启时，去对侧音源搜同曲顶上。UI 仍展示原曲目元数据，只有 `fallbackSource` 标记 + toast 提示换源。

**同曲判定（三条全过才算）**：

1. 标题归一化后全等——归一化 = 小写 + 全角括号转半角 + 去全部空白（CJK 曲名「歌名 (Live)」空格差异由此抹平）；
2. 艺人集合有交集——优先 `artists` 数组，退化到 `artist` 字符串按 `/、,，&` 拆分；
3. 时长差 ≤ 3000ms——任一侧缺时长则跳过此条（宁可放行，标题+艺人已较强）。

候选按搜索相关性排序，取**第一个**匹配（不是最优匹配——上游排序已经是相关性信号）。磁盘缓存 key 跟着兜底曲目走（`cacheTrack = fallback`），缓存的是实际出声的音频。

## 6. 队列与走序（`src/stores/playlist.ts`）

- `queue` + `queueIndex`；播放模式存在 settings（`order / shuffle / one`）。
- **随机模式**用 Fisher-Yates 洗牌出的 `shuffleOrder`（下标排列）循环走序，而非每次随机跳——保证一轮内不重复、prev 可回溯。排列长度与队列失配时懒重建（addToQueue 之后）。
- `handleTrackEnded`：单曲循环原地 `seek(0)+play()`，其余走 `next()`。
- **pending 占位曲目**（懒加载歌单/持久化降级产物，只有 id）：`playAt` 先 `getTracksByIds` 补详情再播；失败则去掉 pending 标记凭 id 兜底直接播（网易播放 URL 只需 id）。补详情期间用户已切歌/换队列则丢弃（比较 queueIndex 和 id）。

## 7. 相邻曲目预加载（`src/lib/track-preload.ts`）

切歌落定 **1 秒后**（防快速连点，只保留最后一次）预解析前/后曲目的播放 URL + 用 `Image` 预热封面 HTTP 缓存。走序计算与 next/prev 完全一致（含随机模式排列）。

**内存纪律**（内存审计后的产物）：每次 preloadTracks 即一个批次，`latestKeep` 集合记录本批次（±当前曲目）的 key；不在集合内的旧条目立即清除，**在途请求晚到时若已不在窗口内直接丢弃不入缓存**。URL 缓存最多 3 条字符串、封面最多 3 个 Image 引用。

URL TTL 5 分钟——网易 CDN 链约十几分钟过期，只作短期预热。`pending` 占位曲目跳过（缺 mid/cover，等补全后的下个批次）。

## 8. 音频代理与磁盘缓存（server 侧）

### 8.1 为什么要代理（`/api/audio`）

上游 CDN 有 Referer/UA 校验且不带 CORS 头，`<audio crossOrigin>` 直连拿不到流。代理统一补 header（`audioProxyHeadersFor` 按 URL 域名选 Referer）、加 `Access-Control-Allow-Origin: *`、透传 Range/Content-Range（拖进度条依赖 206），顺带做磁盘缓存。

### 8.2 磁盘缓存（`server/lib/audio-cache.ts`，2GB LRU）

- **key 由渲染层传入**（`source:id:quality`，与预加载 key 同构，`trackCacheKey` 生成）——上游 URL 带过期签名不能当 key。文件名 = `sha1(key).bin`，目录 `userData/audio-cache/`。
- **只缓存整流**：请求从 0 字节起（无 Range 或 `bytes=0-`）**且**上游响应覆盖完整文件（200，或 206 且 `Content-Range: bytes 0-(N-1)/N`）才旁路落盘；拖进度条产生的中段 Range 只透传。
- **原子落盘**：先写 `.part` 临时文件，转发完整结束后 rename 为 `.bin`；中途断开（切歌）abort 丢弃——不会出现半截缓存被命中。
- **LRU 以 mtime 近似**：命中时 `utimes` 续期；commit 后 `enforceCacheLimit` 超限从最旧开始淘汰。
- 命中时本地文件直接服务（`serveCachedAudio`），支持 `bytes=start-(-end)` Range，无效 Range 回 416 + `Content-Range: bytes */size`。
- 管理端点：`GET /api/audio-cache/stats`（bytes/files/limit）、`/api/audio-cache/clear`（设置页「清除音频缓存」）。

自带直链的曲目（`track.url`）不传 cacheKey → 不缓存（音质未知，key 无法构造）。

## 9. 播放持久化（`src/lib/playback-persistence.ts`）

localStorage key `simplemusic-playback`：队列（剥掉时效 URL）+ queueIndex + 进度（秒）+ 音量。

- **落盘时机**（合并调度，已有更早的待写任务则跳过）：暂停瞬间立即写、音量 800ms、播放中进度最多每 5s、队列变化 500ms、`beforeunload` 兜底。
- **配额降级**：整队列 JSON 超配额时，降级为占位曲目（仅 id/name/mid 等必需字段，`pending: true`），恢复后播到再补详情。
- **恢复为暂停态**：不解析 URL、不自动播；`shuffleOrder` 置空（随机排列不持久化，播放时懒重建）。
- `initPlaybackPersistence()` 幂等（防 React StrictMode 双跑）。

## 10. 睡眠定时器（`src/stores/sleep-timer.ts`）

纯会话态（不持久化）。三相：`idle / counting / finishing-track`。

到点时若 `finishTrack` 开启且正在播（**loading 也算在播**——此刻 pause 会被起播中的 loadTrack 覆盖，挂闸门等播完更稳），不打断当前曲，经 `setStopAfterCurrent` 挂播完即停闸门；否则立即 pause。`finishing-track` 阶段用户关掉「播完再停」= 立即停。

## 11. 系统媒体集成（`src/lib/media-session.ts`）

`navigator.mediaSession`：macOS 控制中心/媒体键/耳机线控。action handler 直连 store（play/pause/prev/next/seekto）；metadata 跟 currentTrack、positionState 节流 1s 同步（rate 一并上报，倍速时系统进度条不漂移）。启动时调用一次，环境不支持静默跳过。

## 12. 改动检查清单

- 改 `loadTrack` 内任何异步步骤：每个 await 后补 `session !== loadSession` 检查。
- 新增"曲目可播性"分支：restriction message 走 toast，别吞成通用文案。
- 改 AudioEngine 节点图：Analyser 必须在 Gain 之前；`pauseTimer` 的取消路径别漏。
- 改缓存 key 构成：渲染层 `trackCacheKey` 与预加载 `trackKey` 同构，两处同步。
- 涉及播放行为的改动 typecheck/test 不够，需 `npm run dev` 实测（淡入淡出、断点续播、兜底换源都是运行时行为）。
