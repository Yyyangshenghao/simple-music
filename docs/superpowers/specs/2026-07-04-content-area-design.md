# 内容区动效（暗夜霞光 · 第二期）设计

日期：2026-07-04
状态：已确认

## 背景与目标

四期计划中的第二期（第一期「全局氛围系统」已交付：`--ambient-*`/`--glow-*` token、`--ambient-gradient`、motion 预设 `springSnappy/springGentle/tapScale/fadeRise`）。本期把卡片、列表、标题从「静态模板感」升级为「有物理手感、跟随氛围色」的交互，并成为第一期 token/预设的首批消费方。

## 范围

**做**：TiltCard 3D 倾斜追光组件（应用于 PlaylistCard/ShelfCard）、RevealItem 入场 stagger（Explore 卡片轨道、Library 歌单架）、GradientText 渐变标题、TrackRow hover 打磨 + 播放中均衡器指示。

**不做**：HeroBanner 大改、页面/详情转场（第三期共享元素过渡一起做）、新增第三方依赖。

## 组件设计

### 1. TiltCard（新增 `src/components/ui/TiltCard.tsx` + `.module.css`）

- 鼠标追踪 3D 倾斜：motion `useMotionValue` + `useSpring`（springGentle 参数）驱动 `rotateX/rotateY`，最大 ±8°，`transformPerspective: 800`
- 卡片内追光光斑：pointermove 直接写 `--spot-x/--spot-y` CSS 变量，`radial-gradient` 用 `color-mix(in srgb, var(--ambient-2) 18%, transparent)`，hover 时淡入
- hover 上浮（y: -4, scale: 1.02）+ `--glow-soft` 辉光渐显；按压 `whileTap scale 0.97`
- `prefers-reduced-motion`：不绑 pointermove（无倾斜/光斑），保留辉光
- 纯 CSS 3D + motion，无 WebGL
- 应用：`PlaylistCard` 与 `ShelfCard` 的最外层（TiltCard 包住现有 BorderGlow，二者叠加：BorderGlow 管边光、TiltCard 管姿态与光斑）；PlaylistCard 原 `.card:hover .coverWrap` 的旧上浮效果移除，避免双重动画

### 2. RevealItem（新增 `src/components/ui/RevealItem.tsx`）

- motion.div + `useInView(once)` + 第一期 `fadeRise` variants + `springGentle`，`delay` prop 控制 stagger
- 应用：ExplorePage 推荐歌单轨道每张卡（delay = i × 0.04）、ShelfScene 歌单架每个 slot（delay = index × 0.04）
- 与既有 AnimatedTrackRow（列表行滚动入场）风格统一；AnimatedTrackRow 本身不动

### 3. GradientText（新增 `src/components/ui/GradientText.tsx` + `.module.css`）

- `<span>` 包裹文字：`background: var(--ambient-gradient)`、`background-size: 200%`、`background-clip: text`、文字透明，8s 缓慢 `background-position` 往返动画（reduced-motion 由全局规则停动画，静态渐变仍在）
- 跟随封面变色（`--ambient-*` 由第一期 hook 动态更新）
- 应用：CardRail 标题、ExplorePage「今日推荐」sectionTitle 与详情页 detailTitle、LibraryPage pageTitle 与 detailTitle、ShelfScene「我的歌单架」heading

### 4. TrackRow 打磨（改 `TrackRow.tsx` + `.module.css`）

- hover：左缘 2px 氛围色 accent 条（`::before`，`var(--ambient-1)`）淡入 + 背景微亮（现有 `--sm-bg-elevated` 保留）
- 播放中指示：当 `usePlayerStore.currentTrack` 与本行 track 的 `provider + id` 相同时，序号替换为 3 根 CSS 动画柱的迷你均衡器（`var(--ambient-1)`），`status !== 'playing'` 时 `animation-play-state: paused`；行名字染 `var(--ambient-2)`
- 每行订阅用窄布尔 selector，避免高频 position 更新引发重渲染

## 错误处理

- 无封面/无数据路径不受影响（组件均为纯展示包装）
- TiltCard 在触摸/无 pointer 环境下退化为普通 hover 卡片

## 测试

- 视觉/交互组件，vitest node 环境无法覆盖 → typecheck + 现有测试回归 + build
- 手动验收：倾斜追光手感、stagger 入场、标题渐变流动与切歌跟色、播放行均衡器动画/暂停、reduced-motion 降级

## 参考

- React Bits：tilted-card、spotlight-card、gradient-text、animated-list（风格参考）
- 一期产出：`--ambient-1/2/3`、`--glow-soft`、`--ambient-gradient`、`motion-presets.ts`
