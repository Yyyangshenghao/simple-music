# 刷歌(Shorts)模式 · 设计文档

> 日期:2026-07-28
> 状态:2026-08-05 已完成体验重构
> 关联记忆:dark-aurora-overhaul(token/motion-presets)、cover-particle-silk(封面粒子)、feature-iteration-v1_4(淡入淡出)、playlist-lazy-loading(loadSession 竞态)、qq-playback-vip-paywall

## 2026-08-05 重构说明（以此为准）

首次实现的实测问题已针对性重构，以下内容取代本文后续章节中的旧交互与视觉决策：

- 精彩段从 20 秒延长为约 30 秒；到片段末尾循环当前段，不再强制自动切歌，由用户主动浏览。
- 高潮定位从“歌词行密度最高”改为“跨段重复歌词簇优先”；没有可靠重复段时，按歌曲结构落在后半段并对齐附近歌词行。
- 完整支持触控板/滚轮、上下拖拽、方向键切歌；前两首相邻曲目的歌词 offset、播放 URL 和 768px 封面会提前预热。
- 移除全屏 WebGL 粒子云，改为大封面、低成本封面背景、当前歌词与片段进度的沉浸舞台；切歌只挂载一张完整卡片。
- 高潮分析最多阻塞起播 90ms；滑出窗口的图片、URL 预取和音频代理流会主动释放，避免连续切歌产生单调增长的内存占用。
- 保留单例 AudioEngine 接管，但补齐无原曲目退出暂停、切源不覆盖原始快照、异步 session 作废等生命周期保护。

旧章节与末尾评估保留为首次方案的历史记录。

## 一、目标

做一个「刷歌」顶级页:像刷抖音一样上下滑动卡片,每首循环播放约 30s 的精彩片段(副歌),由用户主动划到下一首;提供「播放全曲」入口跳回正常播放。用于快速发现推荐流里的新歌。

## 二、关键决策(已确认)

| 维度 | 决策 |
| --- | --- |
| 高潮段定位 | **渲染层纯函数** `highlight-offset.ts`:LRC 行密度滑窗 + 时长偏移兜底。不复用 dj-analyzer(过重),不新增 server 端点 |
| 曲源 | 每日推荐先按近期曝光与本地偏好重排；首歌开播后后台混入私人雷达和随机个性化歌单，耗尽时继续翻推荐歌单页补曲 |
| 播放行为 | 播放约 30s 片段,到 endSec 循环当前片段;「播放全曲」=交还原队列从该曲起播(不从片段秒数续) |
| 形态 | 顶级页 `AppView='shuange'`,全屏垂直 snap 卡片;进入时接管 AudioEngine,退出恢复原队列(暂停态) |
| 音频 | 复用单例 AudioEngine + `player.loadTrack(track,{startAt})`;切歌 200ms 线性淡入淡出 |

### 已否决的备选

- **dj-analyzer 能量分析**:最准但要拉全曲+解码,首播延迟大,单用户桌面不值得;留作后续精度升级。
- **server `/api/highlight` 端点**:跨会话缓存收益对单用户有限,且重复一份密度打分;改由渲染层复用已拉到的歌词。
- **feed 预计算 inline**:feed 响应被 N 次 LRC 抓取阻塞,不可取。

## 三、架构与数据流

```
ShuangePage → useShuangeStore
  ├─ feed 首屏:getDailySongs() → shuange-recommendation.ts 重排
  │    后台:getRadarPlaylist() + 随机 recommend/playlists → 去重追加
  │    画像:近期曝光 + 快速划走/听够片段/红心/播放全曲(localStorage,有界)
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
| `src/lib/shuange-recommendation.ts` | 候选去重、近期曝光降权、歌手间隔、探索随机与本地反馈画像 | localStorage, Track |
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

- **进入**:`enter()` 快照 player → 拉每日推荐并按新鲜度/偏好重排 → 播放第 0 首；私人雷达与随机推荐歌单在后台追加，不阻塞首歌。
- **timeupdate**:hook 监听 `position >= endSec` 并循环当前精彩段；用户划到末首时翻页拉推荐歌单并懒加载详情追加。
- **推荐反馈**:成功播放即记录曝光；真实播放进度不足 6 秒划走降权，达到 18 秒轻度加权，loading/暂停不计时，红心和播放全曲强加权；画像按音源持久化并限制容量。
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
- `shuange-recommendation.test.ts`(纯函数):候选去重、近期曝光、偏好提升、同歌手间隔。
- `shuange.test.ts`(store):首屏避开刚曝光歌曲、后台混入雷达/歌单、enter/leave 快照恢复、next/prev、offset 缓存命中。
- 验证标准:`npm run typecheck && npm test` 通过;播放/转场/接管恢复走 Electron 真机实测(playwright-core 法,见 memory)。

## 十、不在本期内做(YAGNI)

- 副歌精度升级到能量/重复段分析(dj-analyzer 或 essentia.js SSM)——后续可选迭代。
- 跨会话 offset 缓存(server 端点)——单用户不需要。
- 刷歌历史/画像管理页——当前仅保存有界的本地推荐画像，复用现有红心入口。
- 抖音级云端多路召回、协同过滤与模型训练——需要多用户行为数据、服务端埋点和实验平台，本期只做端侧轻量排序。
- 片段循环模式、倍速、睡眠定时——已有或非刚需。

---

## 评估（2026-07-28 用户实测后）

**效果很差。** 分支 `feat/shuange` 保留作留档，不合入 master。

主要问题（待后续重做时参考）：
- 封面粒子云做全屏背景在刷歌场景下观感杂乱、与"听副歌"的核心诉求不匹配，视觉喧宾夺主。
- ~20s 片段 + 自动切的节奏感不如预期，副歌密度定位偏粗糙（LRC 行密度并非可靠副歌代理）。
- 接管/恢复 AudioEngine 与正常播放器的切换链路脆弱，真机首跑即暴露死循环 + R3F Canvas 两处崩溃，工程稳健性不足。

重做方向建议：若再做，先用 dj-analyzer 能量分析或上游字段做精确定位，而非歌词密度；视觉走轻量 CSS 霞光而非全屏 WebGL 粒子；考虑不接管主播放器、改用独立短预览音轨避免恢复链路。
