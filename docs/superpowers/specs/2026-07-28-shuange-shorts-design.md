# 刷歌(Shorts)模式 · 设计文档

> 日期:2026-07-28
> 状态:已与用户确认,待写实现计划
> 关联记忆:dark-aurora-overhaul(token/motion-presets)、cover-particle-silk(封面粒子)、feature-iteration-v1_4(淡入淡出)、playlist-lazy-loading(loadSession 竞态)、qq-playback-vip-paywall

## 一、目标

做一个「刷歌」顶级页:像刷抖音一样上下滑动卡片,每首只听最精彩的 ~20s 片段(副歌),自动切下一首;提供「播放全曲」入口跳回正常播放。用于快速发现每日推荐里的新歌。

## 二、关键决策(已确认)

| 维度 | 决策 |
| --- | --- |
| 高潮段定位 | **渲染层纯函数** `highlight-offset.ts`:LRC 行密度滑窗 + 时长偏移兜底。不复用 dj-analyzer(过重),不新增 server 端点 |
| 曲源 | 每日推荐流 `recommend/songs`(网易+QQ,~20 首),耗尽时用 `recommend/playlists` 个性化歌单懒加载补曲 |
| 播放行为 | 只放 15-30s 片段(默认 20s),到 endSec 自动切下一首;「播放全曲」=交还原队列从该曲起播(不从片段秒数续) |
| 形态 | 顶级页 `AppView='shuange'`,全屏垂直 snap 卡片;进入时接管 AudioEngine,退出恢复原队列(暂停态) |
| 音频 | 复用单例 AudioEngine + `player.loadTrack(track,{startAt})`;切歌 200ms 线性淡入淡出 |

### 已否决的备选

- **dj-analyzer 能量分析**:最准但要拉全曲+解码,首播延迟大,单用户桌面不值得;留作后续精度升级。
- **server `/api/highlight` 端点**:跨会话缓存收益对单用户有限,且重复一份密度打分;改由渲染层复用已拉到的歌词。
- **feed 预计算 inline**:feed 响应被 N 次 LRC 抓取阻塞,不可取。

## 三、架构与数据流

```
ShuangePage → useShuangeStore
  ├─ feed 源:useMusicService().getRecommendSongs()  (recommend/songs,~20)
  │    耗尽:getRecommendPlaylists() → 逐个懒加载详情补曲
  ├─ 高潮偏移:src/lib/highlight-offset.ts (纯函数)
  │    输入 = service.getLyrics(track) 的 LyricLine[] + track.duration(ms)
  │    输出 = { startSec, endSec }
  │    缓存 = 渲染层 Map<`${source}:${trackId}`, offset> LRU ~200
  └─ 播放:player.loadTrack(track,{ startAt: offsetSec })  (AudioEngine 单例接管)
       timeupdate 到 endSec → next();预加载下 1-2 首 URL+offset
```

进入/退出接管:
- `enter()` 快照 player 当前 `{ currentTrack, queue, queueIndex, position, volume }` → 拉首屏 feed → 取/算第 0 首 offset → `loadTrack(track0,{startAt})`。
- `leave()` 恢复快照队列与 `startAt`(暂停态,沿用 `playback-persistence` 恢复模式),交还 AudioEngine。

## 四、组件划分

| 单元 | 职责 | 依赖 |
| --- | --- | --- |
| `src/pages/ShuangePage.tsx` | 全屏垂直 snap 容器,挂载当前±1 张卡片,管理滑动转场 | navigation store, shuange store, useShuangePlayer |
| `src/components/Shuange/ShuangeCard.tsx` | 单卡片:封面粒子背景(复用 cover-particle SILK)+ 歌词当前行 + 标题/歌手 + 红心/播放全曲按钮 | likes store, lyric-parser, motion-presets |
| `src/stores/shuange.ts` | feed 数组 + 当前 index + offset 缓存 + preload 状态 + enter/leave 接管 | player store, music-service, highlight-offset |
| `src/lib/highlight-offset.ts` | 纯函数 `computeHighlightOffset(lines, durationMs)` | lyric-parser 类型 |
| `src/hooks/useShuangePlayer.ts` | 绑定 AudioEngine timeupdate → endSec 切下一首;预加载相邻 URL | audio-engine, shuange store |

边界约束(遵循 CLAUDE.md):
- 单元职责单一、可独立测;`highlight-offset.ts` 是纯函数无副作用。
- 跨音源取 service 用 `serviceFor(track.source)`(`src/lib/service-registry.ts`),不用全局 `useMusicService()` —— feed/缓存里的数据可能属于另一音源,错绑会写错缓存(终审曾抓到 Critical)。
- 新增音源分支处显式处理 `local`(虽然刷歌默认走 activeSource,但补曲来自歌单详情时 track.source 仍可能是 local);`else` 兜底网易会静默出错。
- 动效统一引用 `motion-presets.ts`(springSnappy/springGentle/tapScale/fadeRise)与 tokens.css 的 `--sm-*`/`--glass-*`/`--ambient-*`/`--glow-*`;全屏 WebGL 同屏只跑一个(封面粒子即舞台,不再叠 LiquidEther)。
- 样式用 CSS Modules(同目录 `*.module.css`),主题靠 `data-theme` + tokens。
- `Track.id` 类型 `unknown`,比较/拼 URL 前 `String()`。
- 异步竞态:用 `loadSession` 计数 ref 丢弃过期响应(沿用 ExplorePage 模式);`loadTrack` 已自带 AbortController(aab4f52),切歌无须再叠。

## 五、高潮段算法(纯函数)

```
computeHighlightOffset(lines: LyricLine[], durationMs: number):
  CLIP = 20  // 秒,可配置 [15,30]
  // 回退:行数不足或时长无效
  if lines.length < 8 || !durationMs || durationMs <= 0:
    start = max(0, durationMs/1000 * 0.45 - CLIP/2)
    return 钳制 { start, start+CLIP } 到 [0, durationMs/1000]
  // 主路径:滑窗找密度最高
  ts = lines.map(l => l.timeSec)  // 已排序
  best = { start: 0, score: -1 }
  for each 行 i 作为窗起点:
    w = [ts[i], ts[i]+CLIP]
    score = 窗内行数 - 边界截断惩罚
    if score > best.score: best = { start: ts[i], score }
  endSec = best.start + CLIP
  return 钳制 { best.start, endSec } 到 [0, durationMs/1000 - CLIP](短曲则 [0, duration])
```

设计依据:副歌段 LRC 行数密集(一句一拍或更碎),是零成本可用的代理信号,比固定 40% 偏移更贴真实副歌落点;回退路径覆盖纯器乐/无歌词曲。窗起点用行时间戳而非等分网格,避免漏检。

## 六、音频/片段生命周期

- **进入**:`enter()` 快照 player → 拉首屏 feed → 算 offset0 → `loadTrack(track0,{startAt:offset0.startSec})`。
- **timeupdate**:hook 监听 `position >= endSec` → `next()`;末首触发 feed 补充(调 `getRecommendPlaylists` + 懒加载详情追加到 feed 数组)。
- **预加载**:当前播到 ~50% 时预热下 1 首 `getTrackUrl` + `getLyrics` + `computeHighlightOffset`,仅缓存 URL 与 offset,不预播音频(避免抢占 AudioEngine)。
- **转场淡入淡出**:切歌 200ms 线性音量 ramp(`setVolume` 线性),复用 `feature-iteration-v1_4` 的淡入淡出模式;若 audio-engine 已有 `fadeTo` 则优先复用。
- **退出**:`leave()` 恢复快照队列与 `startAt`(暂停态),交还 AudioEngine;若用户点「播放全曲」则 `navigateTo` 到对应详情/队列并从该曲起播。

## 七、交互

| 输入 | 动作 |
| --- | --- |
| 上滑 / 滚轮下 / ↓ | 下一首 |
| 下滑 / 滚轮上 / ↑ | 上一首 |
| 空格 | 暂停/继续片段 |
| L | 红心(仅网易 supports;QQ/local 不渲染) |
| F | 播放全曲 → 交还队列从该曲起播,退出刷歌 |
| Esc | 退出刷歌(恢复原队列暂停态) |

垂直 snap:framer-motion `AnimatePresence` + `popLayout`(沿用 AppShell 转场);只挂载当前±1 卡片控内存。

## 八、边与错误

- 无歌词 / `getLyrics` 失败 → 偏移回退。
- `getTrackUrl` 失败(VIP 付费墙等)→ 卡片显示"播放失败·下一首",1s 后自动跳过;QQ fee=1 复用此路径并提示"需 QQ VIP"(memory `qq-playback-vip-paywall`)。
- feed 拉取失败 → 空态卡片(引导重试/去每日推荐)。
- 快速滑动竞态:`loadSession` 计数 ref 丢弃过期响应。
- 切音源(`settings.activeSource` 变)→ 刷歌页重置 feed。
- 本地 API URL 不套代理端点(本地曲走 `isLocalApiUrl()` 判定)。

## 九、测试

- `highlight-offset.test.ts`(纯函数):密度命中、行数不足回退、边界钳制、短曲、CLIP 超过曲长。
- `shuange.test.ts`(store):feed 耗尽补充、enter/leave 快照恢复、next/prev、offset 缓存命中。
- 验证标准:`npm run typecheck && npm test` 通过;播放/转场/接管恢复走 Electron 真机实测(playwright-core 法,见 memory)。

## 十、不在本期内做(YAGNI)

- 副歌精度升级到能量/重复段分析(dj-analyzer 或 essentia.js SSM)——后续可选迭代。
- 跨会话 offset 缓存(server 端点)——单用户不需要。
- 刷歌历史/红心歌单单独页——复用现有红心即可。
- 片段循环模式、倍速、睡眠定时——已有或非刚需。
