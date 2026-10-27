# 播放系统

> 从「点击一首歌」到「扬声器出声」的全链路设计文档：URL 解析、跨音源兜底、音频引擎、
> 代理与磁盘缓存、队列走序、预加载、持久化、睡眠定时器、系统媒体集成。
> 相关代码：`src/stores/player.ts`、`src/lib/playback-core.ts`、`src/stores/playlist.ts`、`src/lib/audio-engine.ts`、
> `src/lib/playback-resolver.ts`、`src/lib/track-match.ts`、`src/lib/track-preload.ts`、`src/lib/playback-persistence.ts`、
> `server/routes/netease.ts`（/api/audio）、`server/routes/audio-cache.ts`、`server/lib/audio-cache.ts`。

## 1. 全链路总览

```
用户点击网易云 / QQ / 本地曲目
  → playlist.setQueue(tracks, index) / playAt(index)      # 队列与走序
  → player.loadTrack(track)                               # 创建可取消的播放会话
      1. 在线曲目先查离线索引，命中则直接读取本地文件
      2. 离线文件未命中或媒体加载失败，再进入在线候选链
      3. PlaybackResolver 按手动软优先 → 原源优先 → playbackOrder 生成 N 音源顺序
      4. 原平台排在首位时，track.url / getPreloadedResolution() 命中可直接作为在线首候选
      5. 跨源前由 track-match 保守评分并读取正/负缓存
      6. provider.playback.resolve() 返回同平台有序音质/地址候选
      7. URL 为空继续解析；URL 非空但媒体 error 回到解析器尝试下一候选
  → AudioEngine.load(upstreamUrl, startAt, cacheKey, cacheContext)
  → canplay：提交 resolvedTrack / actualSource / resolution；error：继续同源或跨源降级
  → <audio src="/api/audio?url=<上游CDN>&cacheKey=source:id:quality">
      server: 磁盘缓存命中→本地文件服务(含 Range);未命中→透传上游,整流旁路落盘
  → HTMLAudioElement → MediaElementSource → AnalyserNode → GainNode → destination
                                             │(频谱给可视化)   │(0.25s 淡入淡出包络)
  → 自然播完 ended → stopAfterCurrent 闸门(睡眠定时器) 或 playlist.handleTrackEnded()
```

Apple Music 仍使用同一队列和 player store，但 `PlaybackResolver` 对 Apple 曲目只返回 Apple 候选；`AppleMusicPlayback` 将 `apple-music:` 标识交给后台 MusicKit 会话控制，不经过 HTMLAudioElement、`/api/audio`、跨源替换或离线缓存。详见 §12。

## 2. player store（`src/stores/player.ts`）

单例 zustand store 仍是唯一播放状态容器，通过 `createPlaybackCore` 编排会话。核心实例持有懒创建的普通引擎、Apple 会话、解析器及恢复计时器；`player.ts` 提供引擎工厂、平台/音质状态、API、预加载、通知和听歌上报等宿主能力，既有 store 调用接口保持不变。

核心不导入 React、zustand、全局 store 或浏览器运行时，可用内存状态和模拟音频适配器独立运行。桌面应用由独立 `playback-host.html` 启动 `startPlaybackRuntime()`，统一持有播放核心、队列、最近播放、存档、刷歌、下载、歌词与桌面控制。UI 的 `main.tsx` 只连接宿主并挂载 React。最近播放不等待我的库懒加载，冷启恢复暂停且不补记历史；重连读取活快照，不重新恢复存档。详见 [独立播放宿主](playback-host.md)。

React 挂载/卸载和游戏模式销毁主窗口均不启停后台运行时。主进程正常退出先请求宿主保存断点并补报收听，再统一释放运行时并销毁后台，最后关闭 API；保留 1.8 秒补报及整体 8 秒退出兜底。核心释放后迟到结果不写回、不触发自然结束或睡眠回调。托盘、媒体键和迷你条命令发给唯一后台；UI 通过 session/revision 增量快照重连，慢加载不阻塞后来的暂停或切歌。

`shuange-playback.ts` 按真实导航进入刷歌并在导航离开时恢复原队列；页面只持有键盘、滚轮和拖动交互，最小化、隐藏、游戏模式或卸载 React 不结束会话，重挂不重新 enter。片段进度和媒体自然结束统一推进，按当前原曲的 source + String(id) 校验归属；加载切卡时不拿旧位置推进，仅对已接管的刷歌上下文消费旧 ended，首屏等待推荐仍保留普通队列结束规则。offset 精修先回写后 seek，状态订阅只使旧推进锁失效；旧 next 完成不能解开新卡锁，补货失败或无新卡可重试。

`shuange.ts` 的画像/首选音源订阅由 `initShuangeSession()` 显式启停。运行时停止先完成播放存档，保留刷歌前的队列、随机顺序和断点，再注销推进/订阅、使在途 feed/画像结果失效、补写画像并清除会话；不执行会恢复原音频的 leave。用户主动退出仍恢复进入前的播放/暂停状态；整曲接管先结束刷歌再用剩余 feed 建立新队列，导航离开不恢复已清空的旧快照。上述职责和下载均已迁入独立播放宿主。

`lyrics-loader.ts` 在换歌、实际曲目、参与平台、歌词顺序和相关账号会话变化时重新获取；进度/音量变化不发起新请求。请求序号、AbortSignal、曲目归属及实际使用的账号版本共同拒绝过期结果；账号交换后没有进一步通知时，仍结束失效请求的加载并保留空词。原曲优先、相同来源/ID 去重，内容曲目的 `trackKey` 与歌词实际 `source` 分开；本地同名 LRC 无需在线账号，取消信号透传本地 API。

普通歌词先显示，缺少真实逐字时间时后台查询 QQ 原生 QRC、AMLL 与已参与的网易/QQ 同曲版本，都没有时最后查酷狗歌词库的 KRC（无需登录，候选以 KRC 自带歌名、歌手和时长走同一套同曲校验）。AMLL 查询 QQ 的 MID 和数字 ID；跨平台只接受歌手、版本、ISRC 与时长可靠的匹配，不改变音频来源，也不使用 Apple 作为其他平台的歌词兜底。补全保留歌词偏移，切歌、换账号或歌词已被替换时丢弃迟到结果。本地 LRC 保持原选择；逐字均未命中时，跃字可估算展示节奏，普通歌词仍按行显示。

`lyrics-clock.ts` 使用普通音频 store 进度或 MusicKit 连续位置定位歌词，暂停 seek 和偏移变化立即更新；歌词完成后按当时位置定位。仅 MusicKit playing 开启 50ms 时钟，游戏中保留桌面歌词时为 250ms；游戏纯播放清词、取消请求与位置订阅。运行时停止先取消歌词请求和时钟，再释放核心，界面重挂不重新取词或增加时钟。

`desktop-lyrics-sync.ts` 消费上述歌词并同步原生桌面窗，React 重挂不重发开窗请求或丢失拖框回传标记。只有展示开启且当前行有匹配精准时序才启动 50ms 单字段 `{wordClock}` 推送；普通进度/逐字进度通知不重发整包。原生字号回传先记标记再更新偏好，普通消息真正省略 `size`，用户主动调整字号及开关/游戏确认序号重配则携带完整字号；游戏临时派生单行、暗底、无高亮/逐字/自动宽度，原偏好保留。停止后取消 store/原生订阅及 timer，旧回传和迟到失败不再生效，不把停止当成用户关闭窗口。

`ambient-palette-sync.ts` 监听当前封面并使用原渲染进程的 Image/Canvas 采样，向 ambient store 产出调色板与亮度，迷你条直接消费。普通切页、播放进度及同封面不重新取图；切歌、游戏/刷歌暂停及停止会解除图片回调并丢弃迟到结果，恢复后只取当前封面，无封面或失败回退默认颜色与零亮度。生产层没有补间计时器，不操作根节点 CSS；`useAmbientPalette` 只在界面侧做原有 12 步颜色渐变，卸载清理补间，重挂消费最新 store 而不再次取图。该拆分仍依赖渲染进程，不能替代正式后台宿主迁移。

`wallpaper-sync.ts` 随运行时发送完整 Fx 参数，App 卸载继续同步，重挂不重复推送。游戏中不发送，退出及每次非游戏确认序号变化时补最新完整快照；停止取消订阅，捕获迟到 IPC 失败，不把停止当作关闭壁纸。窗口开关、游戏暂停/恢复与关闭时缓存仍由主进程负责；壁纸页面每次加载完成都会收到主进程缓存，重载不丢配置。

**关键字段**：

| 字段 | 说明 |
|---|---|
| `status` | `idle / loading / playing / paused`，由引擎事件回写 |
| `currentTrack` | 内容来源的 UI 元数据；跨源播放时仍保持原曲目 |
| `position` / `duration` | 秒（注意 `Track.duration` 是毫秒，loadTrack 里 `/1000` 换算） |
| `quality` | 以 settings store 为单一事实来源，经 `subscribe` 回流（`setQuality` 只是转调 settings） |
| `resolvedTrack` / `actualSource` | 媒体进入 canplay 后提交的实际曲目与平台；加载候选期间为 null |
| `resolution` / `playbackAttempts` | 当前在线解析结果与 match / resolve / media-load 诊断链 |
| `playbackTransport` | 实际传输方式：`online / offline / local / musickit`，离线播放不触发在线听歌上报 |
| `rate` | 播放速度（保留音高），**不持久化**，重启回 1 |

**两处解耦回调**（都是为了避免反向 import 成环）：

- `registerTrackEndedHandler(cb)`：自然播完后的走序由 playlist store 决定（player 不知道队列存在）。playlist.ts 底部注册。
- `setStopAfterCurrent(cb)`：睡眠定时器「播完当前曲再停」的一次性闸门。置位后 `onEnded` 不走 next，改调该回调并自动清除。

**loadTrack 的竞态守卫**：核心实例内的 `loadSession` 与单会话 `PlaybackResolver` 共同守卫。切歌先 abort 旧会话；匹配、音质探测和 URL 解析共享 `AbortSignal`，每次异步返回后再次核对参与状态。播放器另用引擎 `loadId` 拒绝已经作废的候选回调。

**平台收听上报**：只统计实际在线出声的网易云/QQ 曲目。`ListeningClock` 同时记录真实收听秒数与有效媒体进度，排除断点位置、暂停、缓冲和 seek 跳跃；倍速按实际经过时间上报，门槛为实际听满 20 秒或有效播放达到曲长的 60%。自然结束、切歌、停止与正常退出结算；同曲音质/设备重载继续累计，实际平台变化分别结算，单曲循环重新累计。账号会话序号与服务端 Cookie 的进程内 HMAC 凭证共同阻止旧收听写入新账号；凭证不包含原始 Cookie。失败静默跳过且不自动重试。

主进程正常退出先通过 preload 请求 `flushListeningReports`，等主 frame 回执后再关 API，最多等待 1.8 秒，沿用整体 8 秒退出兜底。强制结束进程或慢于等待预算的上报可能丢失。网易发送 `startplay`/`play` 日志；QQ 使用官网 `listenReport` 收集通道，返回“已提交”不代表官方账号统计已累计。平台记录/时长仍须在官方入口分别实测，见[需求与验证边界](specs/2026-10-12-listening-records-2.4.0.md)。

**恢复态起播**：重启后 restorePlayback 只回填元数据（引擎无源）。`play()` 检测 `!eng.hasSource && currentTrack` 时转调 `loadTrack(currentTrack, { startAt: position })` 按断点重新解析加载——URL 有时效，持久化里从不存 URL。

## 3. AudioEngine（`src/lib/audio-engine.ts`）

网易云、QQ 和本地播放使用单个 `HTMLAudioElement` + Web Audio 图。**图结构与顺序是刻意的**：

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
- `canplay` 通知 player 提交实际来源；媒体 `error`（含 URL 非空但加载/解码失败）携带 `loadId` 回流解析器。
- `clearSource()` 在候选耗尽时清空元素地址，避免失败后 `play()` 重试旧源。
- `crossOrigin='anonymous'`：MediaElementSource 读跨域音频需要 CORS（代理端已放行）。
- 监听 `navigator.mediaDevices.devicechange`：输出设备切换时若原本正在播放，player 在短暂防抖后从当前进度重新创建解析会话，避免 Chromium 更换扬声器后元素仍显示播放却无声。

## 4. URL 解析与音质阶梯

provider 兼容适配器内部仍复用 `resolveSongUrl(track, quality)`（`src/lib/track-preload.ts`）按音源分流：

- 网易：`GET /api/song/url?id=&quality=`
- QQ：`GET /api/qq/song/url?mid=&mediaMid=&quality=&fee=`（mid 标识歌曲，mediaMid 标识真实音频文件；fee 用于服务端提前判断付费墙）

**服务端音质阶梯**（`server/lib/netease-client.ts`）：请求音质从 `NETEASE_QUALITY_CANDIDATES` 表（jymaster → sky → jyeffect → hires → lossless → exhigh → higher → standard）中定位起点，**逐级降级尝试**直到拿到可播 URL；前两档需 SVIP。`normalizeQualityPreference` 容忍多种别名（flac/sq/320/hq…）。

QQ `/api/qq/song/url` 会按请求音质顺序返回所有可播文件，并把每个文件展开为多个 `sip` 地址候选。网易首次 URL 仍由服务端内部降级；若该地址媒体失败，渲染层再按真实可用音质逐档解析。解析器默认最多记录 24 次尝试，同一会话不重复 URL。

**播放限制分类**（`classifyNeteasePlaybackRestriction`）：全级降完仍无 URL 时，按登录态 + `fee` + `code` + `freeTrialInfo` 归类为结构化的 `PlaybackRestriction`（login_required / trial_only / vip_required / paid_required / copyright_unavailable / url_unavailable），每类带中文 message 和建议 action（login/upgrade/purchase/switch_source）。渲染层 toast 直接用这个 message——**"放不了"时用户看到的是具体原因，不是笼统报错**。

## 5. N 音源匹配与降级（`src/lib/playback-resolver.ts`、`src/lib/track-match.ts`）

只允许“已登录、已明确启用且播放可用”的平台进入来源顺序。Apple 曲目只尝试 Apple；非 Apple 曲目顺序会排除 Apple，避免把受保护音频当作直链替换。`multiSourceFallback=false` 时只尝试最终顺序的第一个平台；手动“本次优先”是软优先，当前平台耗尽后仍可继续降级。

设置里的起播方式与平台顺序作用于网易云、QQ 曲目的在线候选链，并在下次起播时生效，不会立即替换当前音频。普通播放仍先使用本地文件或离线缓存；指定“本次优先”时，只有实际平台与所选平台一致的缓存可直接起播。原平台直链和预解析结果也必须符合当前会话首选平台，不能绕过固定顺序或关闭自动换源的限制。

**同曲判定**：

1. NFKC、大小写、全半角括号、标点和空白统一；
2. 基础标题相同，主要艺人有交集（艺人名末尾的括注别名不参与比较），Live/伴奏/Remix/翻唱/重制/不插电/Demo 版本标签集合一致；
3. 两边都有时长时差值不得超过 3000ms；
4. ISRC、完整标题、艺人、时长和专辑加权，达到 80 分才自动匹配。

匹配缓存与 URL 缓存独立：成功 30 天、未命中 24 小时，保存目标 ID、分数和去除临时 URL 的曲目快照。磁盘缓存 key 始终跟实际候选的 `source:id:quality` 走；试听和自带直链不缓存。

暂停、恢复和定位更新当前播放会话的最新意图；等待离线查询、在线解析及失败候选时，迟到响应不能恢复已暂停的播放或覆盖新定位。切歌与媒体失败候选等待时清除旧音轨，等待期间的旧媒体事件不推进队列。音频输出恢复只作用于同一仍在播放的会话，并使用最新位置；AudioContext 异步恢复也必须服从暂停、换源、清源和销毁操作。

## 6. 队列与走序（`src/stores/playlist.ts`）

队列状态与走序、追加、重排、设为下一首及移除规则位于 `src/lib/queue-state.ts`，不依赖 DOM 或 store。`playlist` store 沿用现有接口，负责平台可用性、异步详情、播放意图与预加载调度；实际队列由独立播放宿主持有，主界面通过状态投影与命令回执交互，详见 [独立播放宿主](playback-host.md)。

- `queue` + `queueIndex`；播放模式存在 settings（`order / shuffle / one`）。
- **随机模式**用 Fisher-Yates 洗牌出的 `shuffleOrder`（下标排列）循环走序，而非每次随机跳——保证一轮内不重复、prev 可回溯。新增曲目时延长排列；长度失配时懒重建。
- 队列面板可将已有曲目设为下一首、拖动或用 Alt + ↑/↓ 调整顺序、移除非当前曲目。随机模式调整的是洗牌排列；单曲循环时“下一首”不可用。
- 面板顶部可清空队列并停止播放，同时取消未完成的播放加载。搜索等入口追加到空队列时不自动起播；点击播放后按当前播放顺序选曲，尚未选曲的队列也会持久化恢复。
- `handleTrackEnded`：单曲循环原地 `seek(0)+play()`，其余走 `next()`。
- **pending 占位曲目**（懒加载歌单/持久化降级产物，只有 id）：`playAt` 先 `getTracksByIds` 补详情再播；失败则去掉 pending 标记凭 id 兜底直接播（网易播放 URL 只需 id）。补详情期间用户已切歌/换队列则丢弃；队列重排后仍按当前播放会话和曲目对象定位。

## 7. 相邻曲目预加载（`src/lib/track-preload.ts`）

切歌落定 **1 秒后**（防快速连点，只保留最后一次）预解析前/后曲目的播放 URL + 用 `Image` 预热封面 HTTP 缓存。走序计算与 next/prev 完全一致（含随机模式排列）。

**内存纪律**（内存审计后的产物）：每次 preloadTracks 即一个批次，`latestKeep` 集合记录本批次（±当前曲目）的 key；不在集合内的旧条目立即清除，**在途请求晚到时若已不在窗口内直接丢弃不入缓存**。URL 缓存最多 3 条字符串、封面最多 3 个 Image 引用。

URL TTL 5 分钟——网易 CDN 链约十几分钟过期，只作短期预热。`pending` 占位曲目跳过（缺 mid/cover，等补全后的下个批次）。

## 8. 音频代理与磁盘缓存（server 侧）

### 8.1 为什么要代理（`/api/audio`）

上游 CDN 有 Referer/UA 校验且不带 CORS 头，`<audio crossOrigin>` 直连拿不到流。代理统一补 header（`audioProxyHeadersFor` 按 URL 域名选 Referer）、加 `Access-Control-Allow-Origin: *`、透传 Range/Content-Range（拖进度条依赖 206），顺带做磁盘缓存。

### 8.2 自动缓存与离线保存（`server/lib/audio-cache.ts`）

- **key 由渲染层传入**（`source:id:quality`，与预加载 key 同构，`trackCacheKey` 生成）——上游 URL 带过期签名不能当 key。缓存文件名 = `sha1(key).bin`，默认目录 `userData/audio-cache/`，已有自定义目录继续读取原缓存配置。
- **只缓存整流**：请求从 0 字节起（无 Range 或 `bytes=0-`）**且**上游响应覆盖完整文件（200，或 206 且 `Content-Range: bytes 0-(N-1)/N`）才旁路落盘；拖进度条产生的中段 Range 只透传。
- **原子落盘**：先写 `.part` 临时文件，转发完整结束后 rename 为 `.bin`；中途断开（切歌）abort 丢弃——不会出现半截缓存被命中。
- **版本化索引**：`.audio-cache-index-v1.json` 记录内容别名、实际音源、档位、MIME、体积和固定状态；索引原子写入并保留备份。旧 `.bin` 首次迁移为 legacy 条目，索引不可恢复时只隔离为“未识别”，不擅自删除。
- **两类生命周期**：完整播放产生自动缓存，受上限与 LRU 管理；用户“保存到本地”后按内容别名固定，不受自动淘汰。跨源同曲可共享同一物理文件，删除共享文件需要二次确认。
- **离线优先**：`player.loadTrack` 在在线解析前查询 `/api/audio-cache/status`，命中后从 `/api/audio-cache/file` 读取；本地文件损坏或丢失会自动回退在线解析。
- **坏文件回退**：媒体加载失败后，本次在线候选链不再传缓存 key，避免代理再次命中坏文件；不自动删除用户固定的文件。
- **保存会话**：下载失败继续同源/跨源下一候选；取消立即释放前端任务并中止请求，迟到结果不能覆盖新任务。状态查询去重后按最多 100 首分批，清理或别名变更后使旧查询失效。
- **主动保存严格完整性**：`POST /api/audio-cache/save` 复用播放器解析出的候选，只接受带可验证长度的完整 200 或从 0 覆盖全文件的 206，校验音频 MIME/文件头，试听片段不保存。
- **LRU 以 mtime 近似**：命中时 `utimes` 续期；commit 后超限从最旧开始淘汰，固定文件、未识别文件和正在读写的文件都不会被自动删除。
- 命中时本地文件直接服务（`serveCachedAudio`），支持 `bytes=start-(-end)` Range，无效 Range 回 416 + `Content-Range: bytes */size`。
- 管理端点：状态批查、固定/取消固定、单文件删除、按自动缓存/已保存/未识别分类统计与清理，以及缓存目录和上限配置。更换目录发现已保存内容时必须再次确认。
- 设置的“缓存与下载”分别管理自动缓存、播放器离线音乐和歌曲下载。普通缓存清理只发送 `temporary`，保留所有带保存别名的音频（包括共用文件的自动缓存别名）；不提供混合清空入口。自动缓存与播放器离线音乐共用缓存目录，更改该目录会清理其中的受管理音频及未识别旧文件，有保留内容时必须确认。歌曲文件有独立下载配置，不会被缓存清理删除。
- **下载队列与导出**：顶栏常驻入口，三首并发并显示字节进度，支持专辑/歌单多选批量入队、暂停开始新任务、取消、重试及保留完成记录。完整缓存可直接导出到选择的目录，使用可读名称和实际音频扩展名，同名不覆盖；导出阶段也占用并发槽。首次下载目录沿用原缓存配置并独立保存，升级不重置缓存；修改下载目录只影响之后加入的任务，旧文件保持原位。
- **下载恢复**：运行时立即将未完成任务的来源身份、曲目信息和原目录保存到 `simplemusic-download-queue`（schema 1），不保存直链或字节进度。最小化/卸载界面继续调度，宿主退出保存后中止请求，重启恢复为暂停队列，点击继续才按当前缓存和账号状态重试；完整缓存直接导出。完成、失败及主动取消不在重启后恢复，清档短暂失败退出时重试，持续存储失败显示风险。读取异常不以新队列覆盖尚未恢复的旧存档，需重启重试。此恢复不保证导出恰好一次：文件已写出而响应丢失时可能生成同名副本，仍不覆盖已有文件。

自带直链的曲目（`track.url`）不传 cacheKey → 不缓存（音质未知，key 无法构造）。

## 9. 播放持久化（`src/lib/playback-persistence.ts`）

localStorage key `simplemusic-playback`，当前 schema 为 2：队列（剥掉时效 URL）+ queueIndex + 随机播放顺序 + 进度（秒）+ 音量。

- **落盘时机**（合并调度，已有更早的待写任务则跳过）：暂停瞬间立即写、音量 800ms、播放中进度最多每 5s、队列或随机顺序变化 500ms、`beforeunload` 兜底。
- **配额降级**：整队列 JSON 超配额时，降级为占位曲目（仅 id/name/mid 等必需字段，`pending: true`），恢复后播到再补详情。
- **兼容与校验**：可读取 1.x 无 schema 存档；未知 schema 不恢复。坏条目会被过滤，并按原始对象重新定位当前曲，避免过滤后下标错位。
- **恢复为暂停态**：混合平台队列保留实体来源，不解析 URL、不自动播；`actualSource` 清空，合法的 `shuffleOrder` 一并恢复，旧存档或损坏顺序置空。用户再次播放时才按当时参与平台创建新解析会话，因此恢复阶段不会访问已禁用或尚未核实登录态的平台。
- `initPlaybackPersistence()` 由运行时启动，重复调用返回同一释放函数；只在该宿主首次启动恢复存档。释放后取消订阅、`beforeunload` 和待写定时器并保存最后快照，重新绑定监听不重新恢复旧档。

## 10. 睡眠定时器（`src/stores/sleep-timer.ts`）

纯会话态（不持久化）。三相：`idle / counting / finishing-track`。

到点时若 `finishTrack` 开启且正在播（**loading 也算在播**——此刻 pause 会被起播中的 loadTrack 覆盖，挂闸门等播完更稳），不打断当前曲，经 `setStopAfterCurrent` 挂播完即停闸门；否则立即 pause。`finishing-track` 阶段用户关掉「播完再停」= 立即停。

刷歌进入 `finishing-track` 后暂停片段自动推进，让当前整曲自然结束，由同一个播完即停闸门停止，卡片改为整曲进度与“当前歌曲播完后停止”提示；取消等待后恢复正常片段推进。自动补货完成前复核播放意图与等待状态；片段定位期间发生暂停时，已选卡载入为暂停，停止或新的播放则作废旧切卡。整曲结束闸门也使在途起播失效，避免旧音频结束后新卡重新出声。最小化或卸载界面不取消定时，宿主退出在最后存档后清理倒计时与闸门，旧时钟不再操作已释放的播放器。

## 11. 系统媒体集成（`src/lib/media-session.ts`）

`navigator.mediaSession`：macOS 控制中心/媒体键/耳机线控。action handler 直连 store（play/pause/prev/next/seekto）；metadata 跟 currentTrack，普通播放进度按 1s 同步；暂停定位、倍速、状态与曲目变化立即更新 positionState（rate 一并上报，倍速时系统进度条不漂移）。由播放运行时启动，环境不支持静默跳过。设置关闭时保留空处理器，阻止浏览器默认动作；运行时终止时取消订阅、解除 handlers 并清空媒体信息，迟到的旧 handler 不再控制播放。

托盘和迷你条的 `miniplayer:control` 由 `desktop-playback-controls.ts` 监听；全局快捷键的注册、设置/录入同步及 `hotkey:triggered` 菜单分发由 `global-shortcuts.ts` 持有，两者均随播放运行时启停。React 只保留应用内按键监听，重新挂载不注销全局键；菜单不受全局开关限制，录入、输入区与 dialog 避让及同键去重保持原规则。停止后旧事件和迟到注册回复不再生效。

`mini-player-sync.ts` 随运行时推送曲目、音量、外观、返回快捷键和已有歌词行；播放进度展示时只按 1Hz 发送，暂停 seek、切曲与重新展示补推一次。游戏模式状态通过宿主的 `game-mode-sync.ts` 监听，临时停止迷你条同步但保留开关偏好，退出后发送最新快照。已水合的开窗偏好只在宿主启动、初值查询先完成且游戏模式关闭时重放一次；查询期间若有主进程模式广播则跳过冷恢复，避免覆盖托盘返回操作；App 重挂不重新开窗，停止后解除宽度事件、store 订阅和计时器。歌词获取与时钟由运行时生产，桌面歌词展示同步也由运行时持有，封面氛围色也由运行时生产，壁纸参数同步也已归运行时，CSS 颜色补间仍在 App hooks；正式后台宿主独立持有上述能力。

## 12. Apple Music 专用播放

平台留存登录态由 `login-status-sync.ts` 随播放运行时核实，不依赖 App 挂载。网易/QQ 仅在宿主启动查询一次，账号会话变化后丢弃旧回复；Apple 状态每次完成后等待 3 秒再刷新，游戏中取消请求和计时，返回重新读取。界面重建不重查，宿主停止取消所有状态请求；取消的 Apple 刷新不更新账号、订阅或错误提示，实际 MusicKit 播放会话不受此轮询取消影响。

`src/lib/apple-music-playback.ts` 接受 player store 的加载与控制命令，经 `/api/apple-music/bridge/*` 到主进程管理的官网 MusicKit 会话。发布版使用应用内隔离窗口；开发态的受保护播放由系统 Chrome 承载。`src/stores/apple-music-connection.ts` 只有在账号已登录且订阅明确有效时才让 Apple 参与播放；订阅未知或无效时不把试听当完整播放，也不静默换到其他音源。

主播放栏、队列、热键、迷你条和睡眠定时器复用 player store 状态。Apple 不使用音质档位、倍速或离线保存；歌词先查 Apple 原生数据，失败时可以从已启用的网易云或 QQ 匹配同曲歌词，此过程不改变音频来源。`src/lib/apple-audio-spectrum.ts` 可尝试采集后台窗口的只读音轨，供现有可视化使用；捕获失败时音频仍由 MusicKit 正常播放。

## 13. 改动检查清单

- 改解析器内任何异步步骤：同时检查 `AbortSignal`、当前平台参与状态和有限尝试数。
- 新增媒体候选：必须等 `canplay` 后再提交 `actualSource`，`error` 必须能回到当前解析会话。
- 改 AudioEngine 节点图：Analyser 必须在 Gain 之前；`pauseTimer` 的取消路径别漏。
- 改缓存 key 构成：使用实际解析曲目的 source/id/quality；不要把跨平台音频写进内容来源的 key。
- 改 Apple Music：检查订阅状态、后台会话撤销和命令序号；不能让 Apple 进入 `/api/audio`、离线缓存或网易/QQ 跨源候选。
- 涉及播放行为的改动 typecheck/test 不够，需 `npm run dev` 实测（淡入淡出、断点续播、兜底换源都是运行时行为）。


## 伴奏生成与“我的伴奏”

伴奏生成由播放宿主的 `src/stores/karaoke.ts` 和 `src/lib/karaoke/queue.ts` 独立持有，不再是播放器开关。用户在播放栏“更多”中明确添加任务，任务记住所选模型与保存目录；切歌、切页面和隐藏主窗口不取消生成，也不会自动生成播放队列中的下一首。单次只处理一个任务，等待任务不加载音频或模型；暂停拦住后续任务，取消终止当前推理进程。冷启动恢复为暂停，恢复或重试时先核对成品，避免退出期间保存成功造成重复生成。

启动前按模型、歌曲时长估算内存并预留系统余量；额外余量按总内存 12% 计算，限制在 1–2 GiB，避免大内存设备长期被过高门槛误拦。不足时每 5 秒重查。解码和模型初始化错开，推理按块处理并释放张量；完成、失败、取消后退出辅助进程，新进程等旧进程实际退出后再启动。运行中系统可用内存低于 512 MB 时停止任务并允许手动重试。内存预算是保护措施，不能承诺显存或进程内存的硬上限；当前输入限制为 128 MB、时长限制为 30 分钟。

辅助进程优先按需加载原生 ONNX WebGPU，减少浏览器 WASM 运行库的开销；初始化不可用时沿用浏览器 WebGPU，不自动切到高内存的 CPU 推理。Worker 保留 FFT、分块和 WAV 写入，私有桥一次只交换一个固定尺寸频谱，不传整首 PCM。模型及精度沿用用户选择；旧会话释放失败时结束任务，避免两套引擎重叠。整应用进程 RSS 对照与平台限制见[架构优化验收](reviews/2026-10-27-karaoke-architecture.md)。

生成以后台交互优先：辅助实例降低自身 CPU 优先级，原生及浏览器路径每块推理后按耗时安排 100–1500 ms 空档，前后处理计入其中，下一块提交前再检查取消。该节奏会增加生成时间；最后一块后不额外等待。实际界面滚动对照与速度取舍见[卡顿修复验收](reviews/2026-10-27-karaoke-responsiveness.md)。

解码后的立体声 PCM 直接转移给分离 Worker，单声道仅复制独立右声道。伴奏逐块写入辅助进程的 OPFS 私有临时文件，等待当前块写入后才继续推理；完成后以磁盘 File 上传，避免额外保留整首 WAV。上传结束或失败后删除临时文件，写入失败或取消时中止并清理；异常退出的残留在下次生成前清理。私有临时文件最多一份，成品仍存入用户所选目录；磁盘不可用时任务失败，不退回整首内存输出。性能对照与范围见[内存优化验收](reviews/2026-10-27-karaoke-memory.md)。

“我的库 → 应用歌单”固定显示不可删除、不可改名的“我的伴奏”，由文件索引投影，不写入普通应用歌单存档。每首歌一行，同一模型复用结果，不同模型作为可选版本。成品以本地索引 ID 播放，保留原曲元数据用于歌词与切回原曲，不依赖模型仍然安装。只有用户主动播放伴奏时才改变播放内容，生成完成不打断听歌。

播放栏音量喇叭左侧的麦克风打开伴奏版本面板，按原曲平台与 ID 列出各模型的已生成版本，并标出当前使用的版本。用户可明确选择一个伴奏或返回原曲，也可选择模型生成其他版本；没有成品时仍可打开面板生成。切换保留进度、暂停状态、原曲身份与队列；切歌关闭面板并恢复原声，生成完成只更新列表，不自动切换。生成任务与成品按同平台的歌曲 ID 或 QQ mid 去重，补齐 mid 不重复入队；已有版本不能重复生成，丢失文件可重新生成。文件播放失败时回到原曲并提示刷新或重新生成。该模式仅在当前播放会话生效，重启不自动恢复。

原唱与已生成伴奏之间切换采用双媒体交接：当前轨持续播放，目标轨先静音起播并按实时媒体时钟校准，误差不超过 2 毫秒时做 80 毫秒线性互补淡变。只保留一条准备轨，切回原唱复用已解析音源；伴奏生成完成后可提前准备。目标加载、起播或对齐失败时继续当前轨并提示；暂停、定位、倍速和音量沿用最新操作，切歌或退出释放准备资源。此处校准的是媒体时间，不补偿不同录音版本或分离文件自身的时间偏移。

保存目录可在“K 歌模型”设置中更改，仅影响之后加入的任务。Windows 安装版初始尝试安装目录的 `Accompaniments`；不可写时回退到系统音乐目录并提示。Portable 使用 `PORTABLE_EXECUTABLE_DIR/Accompaniments`，不使用临时解包位置，目录内索引可随文件整体移动。macOS 和开发模式默认使用音乐目录下的 `Simple Music/Accompaniments`。自选目录不可用时保留错误，不静默换位置；旧目录成品仍按原位置读取。
