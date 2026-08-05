# 刷歌(Shorts)全分支终审

> 范围:57349c6..0807f1e(8 commits,feat/shuange)
> 审查者:fable(全分支 spec 合规 + 代码质量 + 跨任务一致性)
> 日期:2026-07-28

## 总览结论

- Spec 合规:**部分不达标** — 三项交互/生命周期/边界条目未真正落地(Esc 退出、切音源重置 feed、淡入淡出之"淡出"侧)。
- 跨任务接口一致性:**签名对齐** — `HighlightRange{startSec,endSec}` → `useShuangeStore` → `useShuangePlayer` → `ShuangeCard` → `ShuangePage` → `navigation/AppShell/TopBar` 字段名与方法签名全程一致,无断裂。Task 间 plan 自我修正项(`getDailySongs` 命名、`__resetOffsetCache` 导出、`likeKeyOf`/`likedByKey` 接入)均已在实现中落地。
- 整体定级:**Needs fixes** — 1 Critical + 2 Important 必须在合并前修。

---

## Critical

### C1. Esc 退出刷歌无效,触发 enter↔leave 死循环

**位置:** `src/pages/ShuangePage.tsx:38`(键盘 Esc 分支)、`src/pages/ShuangePage.tsx:22-28`(enter useEffect)

**现象:**
Esc 处理仅调用 `st.leave()`,而 `leave()` 只 `set({ active: false })` + 恢复队列,**不调用 `navigateTo`**。`currentView` 仍是 `'shuange'`,`ShuangePage` 未卸载。其 `useEffect` 依赖 `[active, enter]`,`active` 翻为 false 后清理函数读到 `getState().active === false` 跳过 `leave`,随后 effect 主体 `if (!active) void enter()` 立即重新进入刷歌。用户按 Esc 反而被困在 enter→Esc→enter 死循环。

spec ①(enter/leave 接管与恢复原队列暂停态)与 ⑦(Esc 退出刷歌)均未达成。

**修复建议:** Esc 分支调用 leave 后同步导航出去,沿用 `playFullCurrent` 的退出路径:
```ts
else if (e.key === 'Escape') {
  st.leave()
  useNavigationStore.getState().navigateTo('explore')
}
```
(需在 `ShuangePage.tsx` 顶部 `import { useNavigationStore } from '../stores/navigation'`。)

更彻底的做法是把 `leave()` 拆为 `leave(options?: { navigate: boolean })`,由调用方决定是否导航;但最小修复是上面两行。

**验证:** 真机按 Esc 后应跳回探索页、原队列恢复为暂停态、ShuangePage 卸载(keydown 监听随之移除)。

---

## Important

### I1. playFullCurrent 缺少 session 守卫,在途 loadIndex 会覆盖整曲播放

**位置:** `src/stores/shuange.ts:132-141`(`playFullCurrent`)

**现象:**
`playFullCurrent()` 不 `++shuangeSession`(对比 `leave()` 与 `enter()/loadIndex()` 均递增)。若用户在 `loadIndex(i)` 的 `await ensureOffset(track)` 期间按 F:
1. `loadIndex(i)` 已记录 `my = ++shuangeSession = N`,在 await。
2. `playFullCurrent` 同步执行:`snapshot=null`、`set({active:false})`、`setQueue(feed.slice(index), 0)` → `playAt(0)` → `loadTrack(feed[i], {contextId})` 整曲从 0:00 起播。
3. ensureOffset resolve,`loadIndex` 回到 `if (my !== shuangeSession) return` — 但 `my === shuangeSession === N`(playFullCurrent 没递增)→ 守卫放行 → `set({offset, loading:false})` + `loadTrack(track, {startAt: range.startSec, contextId: 'shuange:…'})` **把整曲播放覆盖回片段起播点**。

spec 六生命周期 ④("playFullCurrent 交还队列从该曲起播")被破坏:用户按 F 后听到的是片段秒数,不是整曲。

**修复建议:** `playFullCurrent` 开头加 `++shuangeSession`:
```ts
playFullCurrent() {
  ++shuangeSession // 作废在途 loadIndex/enter/next,防止覆盖整曲播放
  const { feed, index } = get()
  ...
}
```

**验证:** 单测加一条 — enter 后立即 playFullCurrent,再 resolve getDailySongs/getLyrics,断言 `loadTrack` 最后一次调用的 `startAt` 为 0(或 undefined),而非片段 offset。

### I2. ShuangePage 与 AmbientBackground(LiquidEther)同屏双 WebGL

**位置:** `src/App.tsx:85`(`AmbientBackground hidden` 条件)、`src/components/Shuange/ShuangeCard.tsx:27`

**现象:**
`AmbientBackground` 的 `hidden` 条件是 `(lyricsOpen && lyricsMode === '3d') || !!detailBackdropCover`,**不包含 `currentView === 'shuange'`**。ShuangePage 渲染 `CoverParticleCloud` 作背景,而 App 层的 `LiquidEther` 仍在后台跑 — 同屏两个全屏 WebGL 场景,违反 spec 四组件边界("全屏 WebGL 同屏只跑一个:刷歌卡片用 CoverParticleCloud 作背景,不再叠 LiquidEther")与 CLAUDE.md 同名约定。GPU/风扇风险(参考 memory `gpu-performance-audit`)。

**修复建议:** `src/App.tsx:85` 把 `currentView === 'shuange'` 纳入 hidden:
```ts
<AmbientBackground
  hidden={
    (lyricsOpen && lyricsMode === '3d')
    || !!detailBackdropCover
    || useNavigationStore.getState().currentView === 'shuange'
  }
/>
```
(若 App.tsx 已订阅 `currentView` 则用 hook 值,避免 getState;需要看 App 现有写法。)

**验证:** 进入刷歌页后 AmbientBackground 的 `<div style={display:none}>`,LiquidEther 的 IntersectionObserver 暂停;退出后恢复。

---

## Important(spec 偏差,建议修但不强制阻断)

### I3. 切歌只淡入、无淡出(spec "淡入淡出" 之"淡出"侧未实现)

**位置:** `src/lib/audio-engine.ts:101-115`(`load` 直接 `rampGain(0,0)` 即时归零)、`src/stores/shuange.ts:loadIndex` 末尾调 `loadTrack`

**现象:**
spec 二决策与六生命周期均写"切歌 200ms 线性淡入淡出"。实际 `loadTrack` 调 `eng.load(newUrl)`,engine 在 `load()` 内 `rampGain(0, 0)`(瞬时归零)后替换 `audio.src`,**前一曲硬切**,新曲经 `'playing'` 事件 `rampGain(1, FADE_SEC=0.25s)` 淡入。淡出侧缺失。FADE_SEC=0.25s ≈ 200ms 量级,淡入量级合规。

progress.md Task 3 记载"复用 engine 内置 rampGain",但 engine 的 rampGain 只在 `play()`/`pause()` 触发,`load()` 是硬切。

**修复建议(二选一):**
- (A) `loadIndex` 在调 `loadTrack` 前,先 `usePlayerStore.getState()._engine().pause()` 触发 0.25s 淡出,等 ~250ms 再 `loadTrack(new)`。代价:切歌延迟 250ms。
- (B) 接受现状(硬切+淡入),在 spec/progress 显式标注"淡出侧省略,因 engine.load 硬切是既有行为,跨曲淡出需重构 load 流程",并入后置待办。

**建议:** 默认走 (B),在 final-review 留痕即可;若用户对切歌观感有要求再上 (A)。**不阻断合并**,但 spec 条目需据实更新。

### I4. 切音源不重置 feed(spec 八边界明文要求)

**位置:** `src/stores/shuange.ts`(无 `useSettingsStore.subscribe`)

**现象:**
spec 八:"切音源(`settings.activeSource` 变)→ 刷歌页重置 feed"。store 仅在 `enter()` 与 `appendMoreFeed()` 读 `useSettingsStore.getState().activeSource`,**未订阅变化**。用户在刷歌页通过 TopBar `SourceAvatar` 切音源后,feed 不重置,offset 缓存按 `source:id` 分键虽不会污染,但 feed 仍是旧源歌曲,新源的歌要到下次手动重进才出来。

**修复建议:** store 顶层订阅:
```ts
useSettingsStore.subscribe((s, prev) => {
  if (s.activeSource !== prev?.activeSource && useShuangeStore.getState().active) {
    void useShuangeStore.getState().enter() // 重新拉 feed
  }
})
```
或更保守:在 `ShuangePage` 用 `useSettingsStore((s) => s.activeSource)` 作 effect 依赖,变化时调 `enter()`。

**验证:** 刷歌中切 QQ→网易,feed 立即重拉,卡片切换为新源曲目。

---

## Minor(不阻断,记录即收口)

### M1. Task2 缓存负向断言路径不精确(progress 已列)
`shuange.test.ts:69-73` "offset 缓存命中" 用 `prev()`(index 0 不触发 loadIndex)验证"未调 getLyrics",但 `prev()` 本就不调 `ensureOffset`,断言未真正覆盖 `loadIndex` 缓存命中路径。建议加一条:enter 缓存 track1 后 `loadIndex(0)` 再调,断言 `getLyrics` 未被调用。

### M2. Task2 pause 微任务未断言(progress 已列)
`leave()` 的 `.then(() => pause())` 链未被测试断言;`leave` 测试只检查 `loadTrack` 调用,未验证最终 `pause()` 被调用。建议 `await flushPromises()` 后 `expect(pause).toHaveBeenCalled()`。

### M3. 末尾换行缺失(progress 已列,4 文件)
`ShuangeCard.module.css`、`ShuangeCard.tsx`、`highlight-offset.ts`、`highlight-offset.test.ts`、`ShuangePage.module.css`、`ShuangePage.tsx`、`useShuangePlayer.ts` 末尾 `\ No newline at end of file`。`npm run typecheck` 与 vitest 不报,但违反 POSIX 文本文件惯例,git diff 也吵。修法:编辑器末尾回车即可。

### M4. Task6 ShuangePage 键盘 handler getState 多次调用(progress 已列)
`onKey` 内 `useShuangeStore.getState()` + `usePlayerStore.getState()` + L 分支再 `useLikesStore.getState()`。每按键 3 次 getState — 量级极低,非瓶颈。可读性可接受,记录不处理。

### M5. highlight-offset 0.5 容差未命名常量(progress 已列)
`if (wEnd > durSec + 0.5) continue` 的 0.5 秒容差是魔法数字。建议提为 `const EDGE_TOLERANCE_SEC = 0.5`。O(n²) 在 ≤几百行 LRC 下非瓶颈,记录不处理。

### M6. offsetCache 模块级 Map 跨会话不清理(可接受)
`offsetCache` 是模块级 `Map`,ShuangePage 退出后不清空。spec 二明文"渲染层 Map LRU ~200",跨会话缓存是设计意图(单用户,LRU 上限 200 防无界增长)。`__resetOffsetCache` 已供测试用。**合理,不处理。**

### M7. shuange store 动态 `import('./settings')` 无循环依赖(已核实)
核实 `src/stores/settings.ts` 不 import `./shuange`,无成环。动态 import 是为避免初始化期循环(plan Task2 注释提及),实现正确。`vi.mock('./settings')` 已在测试中 stub。**无风险。**

### M8. playFullCurrent 队列语义与 spec 字面偏差(可接受设计)
spec 二/六写"交还**原**队列从该曲起播",但 feed 曲目不在原队列(snap.queue)中,字面不可能。实现用 `feed.slice(index)` 作新队列从 0 起播(整曲,非片段秒数),符合 spec 真意("从该曲起播、不从片段秒数续")。navigateTo('explore') 后 ExplorePage 不直接显示该队列,但 player 已开始播 — 用户听到整曲即达成。**记录,不处理。**

### M9. CoverParticleCloud 与 LyricsPanel cover-cloud 潜在同屏(范围外)
若用户在刷歌页打开歌词面板且 `lyrics3dEffect === 'cover-cloud'`,会同时挂两个 CoverParticleCloud。但 AmbientBackground 已在 `lyricsOpen && lyricsMode === '3d'` 时 hidden,LyricsPanel 的 cover-cloud 是另一个实例 — 仍可能双 WebGL。属边界场景,spec 未覆盖,并入后置待办。

### M10. useShuangePlayer 无 next() 防抖(低风险)
position 更新 ~4Hz,`next()` 触发后 `loadIndex` 同步 `set({offset: null})`,hook effect 重订阅闭包更新为新 offset(null)→ 不会再触发 next。实测中重复 next() 概率低。建议后续加 `firingRef` 防御,本次不阻断。

---

## Spec 逐项核对

| spec 节 | 条目 | 状态 | 备注 |
|---|---|---|---|
| 二/决策 | 渲染层纯函数 highlight-offset | ✅ | Task1 |
| 二/决策 | feed=recommend/songs,耗尽补 playlists | ✅ | enter+appendMoreFeed |
| 二/决策 | 15-30s 片段默认 20s 到 endSec 自动切 | ✅ | CLIP_SEC=20,hook timeupdate |
| 二/决策 | 播放全曲=交还队列从该曲起播 | ⚠️ | I1 race;M8 队列语义字面偏差 |
| 二/决策 | 进入接管 AudioEngine,退出恢复原队列暂停态 | ✅(enter/leave)❌(Esc) | C1 |
| 二/决策 | 切歌 200ms 线性淡入淡出 | ⚠️ | I3 仅淡入 |
| 三/架构 | ShuangePage→store→useShuangePlayer→Card→Page | ✅ | 接口全程对齐 |
| 四/组件 | 五单元职责边界 | ✅ | |
| 四/边界 | serviceFor(track.source) 不用全局 useMusicService | ✅ | ensureOffset 用 track.source |
| 四/边界 | local 分支显式处理 | ✅(moot) | feed 来自 getDailySongs 仅网易/QQ,local 不会进 feed |
| 四/边界 | 全屏 WebGL 同屏只跑一个 | ❌ | I2 |
| 四/边界 | loadSession 计数 ref 丢弃过期响应 | ✅ | shuangeSession 实现 |
| 五/算法 | 滑窗密度 + 行数不足回退 + 边界钳制 | ✅ | 测试覆盖 |
| 六/生命周期 | enter 快照→loadIndex(0) | ✅ | |
| 六/生命周期 | timeupdate 到 endSec → next,末首补 feed | ✅ | |
| 六/生命周期 | 预加载下 1 首 URL+offset | ❌ | 主动放弃(plan Task3 已说明),记 YAGNI |
| 六/生命周期 | 淡入淡出 | ⚠️ | I3 |
| 六/生命周期 | leave 恢复快照暂停态 | ✅ | |
| 七/交互 | ↑↓ 切歌 | ✅ | |
| 七/交互 | 空格暂停/继续 | ✅ | |
| 七/交互 | L 红心(仅 supports 渲染) | ✅ | ShuangeCard 条件渲染 |
| 七/交互 | F 播放全曲 | ⚠️ | I1 race |
| 七/交互 | Esc 退出 | ❌ | C1 |
| 八/边界 | 无歌词回退 | ✅ | fallbackRange |
| 八/边界 | getTrackUrl 失败 1s 跳过 + QQ VIP 提示 | ❌ | 未实现自动跳过;loadTrack 失败仅 status idle,无 1s 跳过逻辑 |
| 八/边界 | feed 拉取失败空态 | ✅ | error 文案 |
| 八/边界 | 快速滑动竞态 loadSession | ✅ | shuangeSession |
| 八/边界 | 切音源重置 feed | ❌ | I4 |
| 八/边界 | 本地 API URL 不套代理 | ✅(moot) | feed 不含 local |
| 九/测试 | highlight-offset.test | ✅ | 4 用例,真断言 |
| 九/测试 | shuange.test | ✅ | 5 用例,真断言(M1/M2 加强建议) |
| 九/测试 | typecheck + test 通过 | 待跑 | 见下 |
| 九/测试 | 真机实测 | ⏳ | 用户执行 |
| 十/YAGNI | 能量分析/跨会话 offset 缓存/刷歌历史/循环倍速 | ✅ | 未做 |

---

## 必修清单(合并前)

1. **C1**:ShuangePage Esc 分支补 `navigateTo('explore')`(或 leave 内带导航选项)。
2. **I1**:`playFullCurrent` 开头 `++shuangeSession`,补一条单测。
3. **I2**:App.tsx AmbientBackground `hidden` 条件加 `currentView === 'shuange'`。
4. **I3/I4**:二选一处理 — 要么修实现(切歌淡出、activeSource 订阅),要么在 spec/progress 显式降级标注,二者都需在合并前明确。

## 可选收口(不阻断)

- M1 缓存命中负向断言加一条 loadIndex 路径。
- M2 leave pause 断言。
- M3 末尾换行(顺手)。
- M5 0.5 容差提常量。
- M10 next() 防抖 ref(后续)。

## 验证

未在本次跑 `npm run typecheck && npm test`;建议修完 C1/I1/I2 后跑一次全量 + 真机 Esc/F/切音源三路径手测。基线 57349c6 的 typecheck/test 应保持绿。

---

## Fix round

> 日期:2026-07-28
> 范围:C1 / I1 / I2 / I4(I3 按终审建议走方案 B,接受为文档化取舍,不修)

### C1 — Esc 退出死循环

`src/pages/ShuangePage.tsx`:Esc 分支在 `st.leave()` 后同步 `useNavigationStore.getState().navigateTo('explore')`,让 ShuangePage 卸载、keydown 监听随之移除,打破 enter↔Esc 死循环。顶部补 `import { useNavigationStore } from '../stores/navigation'`。

### I1 — playFullCurrent session 守卫

`src/stores/shuange.ts`:`playFullCurrent()` 开头 `++shuangeSession`,作废在途 `loadIndex`/`enter`/`next` 的 await 后校验,防止在途异步覆盖整曲播放。

### I2 — 双 WebGL 同屏

`src/App.tsx`:`AmbientBackground hidden` 条件追加 `currentView === 'shuange'`,刷歌页进入时隐藏全局 LiquidEther,避免与 CoverParticleCloud 同屏双 WebGL。补 `import { useNavigationStore }` 与 `const currentView = useNavigationStore((s) => s.currentView)`。

### I4 — 切音源不重置 feed

`src/stores/shuange.ts`:store 创建后动态 `import('./settings')` 并 `useSettingsStore.subscribe`,当 `activeSource` 变化且刷歌 active 时调 `enter()` 重新拉 feed。动态 import 避免初始化期循环依赖(与 enter 内一致)。
`src/stores/shuange.test.ts`:mock 补 `subscribe: () => () => {}` 以适配新增订阅。

### I3 — 切歌淡出(不修,文档化取舍)

接受现状(硬切 + 淡入 0.25s)。engine.load 内 `rampGain(0,0)` 瞬时归零是既有行为,加手动 rAF 淡出会重引入泄漏/覆盖风险(Task 3 已移除过)。spec 六"淡入淡出"条目据实降为"仅淡入",后续若用户有切歌观感要求再议。

### 验证命令与输出

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.json
(无输出,exit 0)

$ npm test
 Test Files  35 passed (35)
      Tests  270 passed (270)
   Duration  1.18s
```

typecheck 双套 tsconfig 全绿;vitest 35 文件 270 用例全过,无 unhandled error。
