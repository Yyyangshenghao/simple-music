# 页面转场（暗夜霞光 · 第三期）设计

日期：2026-07-04
状态：已确认

## 背景与目标

四期计划中的第三期。一期（氛围系统）、二期（内容区动效）已交付。本期解决「切换生硬」：页面切换只有 220ms CSS 淡入（无退场、无方向感），Explore/Library 的歌单详情是硬条件切换。目标：封面共享元素飞入详情、页面纵深转场、并修复二期终审移交的 stagger 无封顶遗留。

## 范围

**做**：navigation store 方向标记、AppShell AnimatePresence 纵深转场、PlaylistCard→详情封面共享元素（Explore + Library）、详情内容错峰入场、AnimatedTrackRow delay 封顶、App 根挂 `MotionConfig reducedMotion="user"`。

**不做**：LyricsPanel 与 ShelfDetail 浮层转场；新增依赖。

## 设计

### 1. navigation store 方向标记（改 `src/stores/navigation.ts`）

- 新增 `lastAction: 'push' | 'pop'`（初始 `'push'`）；`navigateTo` 置 `'push'`，`goBack` 置 `'pop'`
- 可在 node 环境单测（TDD）

### 2. AppShell 纵深转场（改 `AppShell.tsx` + `.module.css`）

- `Suspense` 内改为 `<AnimatePresence mode="popLayout" initial={false} custom={dir}>` + `motion.div key={viewKey}`
- `dir = lastAction === 'pop' ? -1 : 1`，variants（custom 方向）：
  - enter：`opacity 0, scale 1.03, x 24×dir, y 8`
  - center：`opacity 1, scale 1, x 0, y 0`
  - exit：`opacity 0, scale 0.97, x -24×dir`
- 过渡用 `springGentle`；`mode="popLayout"` 让退场页绝对定位脱流，新旧页真实交叠
- 删除 CSS `.pageEnter` 与其 keyframes，替换为 `.page`（保留 `height:100%; position:relative; z-index:1`）

### 3. 封面共享元素（改 `PlaylistCard.tsx`、`ExplorePage.tsx`、`LibraryPage.tsx`）

- `PlaylistCard` 加可选 `layoutId?: string`：封面容器 `div.coverWrap` 变 `motion.div`，有 layoutId 时挂 `layoutId` + `springGentle` layout 过渡；未传时行为不变
- 页面侧传入命名空间化 ID 防跨页冲突：Explore `explore-cover-${String(pl.id)}`、Library `library-cover-${String(pl.id)}`
- 详情头部封面 `<img className={detailCover}>` 变 `motion.img`，layoutId 与对应卡片一致 → 打开详情封面从卡片飞到头部，返回时飞回
- 详情页非封面内容（标题块 + 歌曲列表容器）用 `fadeRise` + `springGentle`、`delay 0.15` 错峰入场，等封面先落位

### 4. reduced-motion 全局策略（改 `App.tsx`）

- 根组件包 `<MotionConfig reducedMotion="user">`：系统开启减弱动态时，motion 自动禁用 transform/layout 动画（含共享元素、纵深转场、TiltCard hover），仅保留 opacity——一并解决二期遗留的「TiltCard 模块级快照不响应运行时切换」

### 5. AnimatedTrackRow delay 封顶（改 `AnimatedTrackRow.tsx`）

- 组件内 `delay: Math.min(delay, 0.4)`——单点修复三处调用（长列表末行不再等 5s），调用方不改

## 错误处理 / 边界

- 详情打开是异步（先拉 tracks 再 setDetail）：共享元素在数据就绪后才触发，加载中卡片不动，行为与现状一致
- lazy 页面在 AnimatePresence 内 suspend：Suspense 在外层兜底，与现状一致
- `layoutId` 未传时 PlaylistCard 完全等价旧行为（ShelfScene 等其他使用点不受影响）

## 测试

- 单测（vitest node）：navigation store `lastAction` 状态流转（push/pop/边界：history 空时 goBack 不变）
- 回归：typecheck + 全量测试 + build
- 手动验收：点卡片封面飞入详情/返回飞回；页面切换新旧页交叠纵深；前进/返回横移方向相反；长列表末行进入视口即入场；系统减弱动态时转场退化为淡入淡出

## 参考

- motion（framer-motion v12）：layoutId 共享元素、AnimatePresence popLayout、MotionConfig reducedMotion
- 二期终审移交项：AnimatedTrackRow delay 无封顶
