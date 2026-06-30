# Animated Track List — 滚动动画设计

**日期**: 2026-06-30
**状态**: 设计中

## 目标

为所有歌曲列表（ExplorePage 今日推荐、歌单详情；LibraryPage 歌单详情）添加滚动进入/离开动画，使用 `motion` 的 `useInView` 实现。

## 参考

React Bits `AnimatedList` 组件模式，适配到本项目的页面级滚动模型。

## 组件设计

### AnimatedTrackRow (`src/components/Explore/AnimatedTrackRow.tsx`)

在现有 `TrackRow` 外层包裹 `motion.div`，每个 item 独立检测 viewport 可见性。

```tsx
// Props
interface AnimatedTrackRowProps {
  track: Track
  index: number
  onPlay(): void
  delay?: number  // 默认 0.1，用于交错效果
}

// 行为
// - useInView(ref, { amount: 0.5, triggerOnce: false })
// - 进入视口: scale 0.7→1, opacity 0→1, duration 0.2s
// - 离开视口: scale 1→0.7, opacity 1→0
// - 支持 delay prop 实现交错动画
```

### 渐变遮罩

直接加在页面 `.page` 容器内，跟随页面滚动控制透明度：

- **顶部渐变**: 高 50px，`linear-gradient(to bottom, var(--sm-bg-base), transparent)`
- **底部渐变**: 高 100px，`linear-gradient(to top, var(--sm-bg-base), transparent)`
- **定位**: `position: sticky` 在 `.page` 滚动容器内部，顶部 `top: 0`，底部 `bottom: 0`，`z-index: 1`
- **控制逻辑**: 通过 JS `onScroll` 读取 `scrollTop` / `bottomDistance`，除以 50 映射到 opacity
- **pointer-events: none** — 不阻挡交互

由于项目使用 `--sm-bg-base`（`#0c0c0c` 深色 / `#f0f0f0` 浅色），渐变跟随主题自动适配。

## 页面改动

### ExplorePage.tsx
1. 导入 `AnimatedTrackRow` 替换 `TrackRow`（3 处：今日推荐列表、歌单详情列表）
2. `.page` 容器添加 `onScroll` 事件 + 渐变元素
3. 新增 state: `topGradientOpacity`, `bottomGradientOpacity`

### LibraryPage.tsx
1. 导入 `AnimatedTrackRow` 替换 `TrackRow`（歌单详情列表）
2. 同样添加渐变遮罩逻辑

### CSS 改动
- `ExplorePage.module.css`: 添加 `.topGradient` / `.bottomGradient` 样式
- `LibraryPage.module.css`: 添加同样样式
- 渐变共享样式抽取到 `src/styles/scroll-gradients.css`，页面 CSS 通过 `@import` 引用

## 边界情况

- **空列表**: 不渲染渐变（无内容无需遮罩）
- **内容不足一屏**: 底部渐变 opacity 为 0
- **性能**: `useInView` 使用 IntersectionObserver，对大量 item 性能友好；`triggerOnce: false` 确保来回滚动都有动画
- **motion 已安装**: v12.42.1，无需额外依赖

## 不做

- 键盘导航（方向键选择、Enter 播放）
- 自定义滚动条样式
- 选中高亮状态

## 验证

- 在 ExplorePage 滚动"今日推荐"列表，确认每行有缩放+淡入动画
- 进入歌单详情页，滚动长列表，确认动画连续
- 在 LibraryPage 歌单详情中同样验证
- 确认渐变遮罩边缘位置平滑过渡
- 确认深色/浅色主题下渐变颜色跟随主题变量
