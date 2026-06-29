# 设计文档：左侧模块化导航 + FlowingMenu 动画

**日期**：2026-06-29  
**状态**：已审批，待实施

---

## 1. 目标

将现有顶部 TitleBar 导航（探索/我的库/设置 + 音源 + 头像）重构为左侧模块化交互区，每个功能模块以"折叠图标→hover 展开"的方式呈现，配合 GSAP 丝滑动画。取消 TitleBar 组件，主内容区铺满全屏，PlayerBar 不再遮挡内容。

---

## 2. 整体布局

```
WindowChrome
└── div.root (flex-column)
    ├── div.content (flex-row, flex:1, overflow:hidden)
    │   ├── LeftStrip (52px, position:relative, z-index:200)
    │   └── AppShell (flex:1, overflow-y:auto, padding-bottom: PlayerBar高度)
    └── PlayerBar (flex-shrink:0, position:relative, 不遮挡内容)
```

**关键变更**：
- 删除 `TitleBar` 组件及其 import
- `App.tsx` 新增 `div.content` 横向 flex 容器
- `AppShell` 改为可滚动，`padding-bottom` 通过 CSS variable `--player-bar-height` 动态注入（PlayerBar 挂载后用 ResizeObserver 测量实际高度并写入 root style）
- `PlayerBar` 确保 `position: relative`，不使用 absolute/fixed

---

## 3. LeftStrip 组件

**文件**：`src/components/Layout/LeftStrip.tsx`

### 3.1 视觉结构

```
┌──────────┐
│  48px    │  macOS traffic lights 占位，-webkit-app-region: drag
│  拖拽区  │
├──────────┤
│  🔍      │  SearchModule
│  🧭      │  NavModule（探索/我的库/设置）
│          │
│  flex:1  │  弹簧间距
│          │
│  🎵      │  SourceModule
│  👤      │  AccountModule
└──────────┘
```

**样式**：
- 宽度：52px，固定
- 背景：`var(--sm-bg-elevated)`，`backdrop-filter: var(--sm-blur)`
- 右边框：`1px solid var(--sm-border)`
- z-index：200（高于主内容区）

### 3.2 图标种子交互

每个图标种子 hover 时：
- `scale(1.18)` + 淡入 accent 色光晕（`box-shadow: 0 0 12px var(--sm-accent)`）
- duration: 0.2s，ease: `power2.out`
- GSAP `overwrite: "auto"` 避免动画堆叠

---

## 4. 展开 Panel 系统

### 4.1 通用行为

- **触发**：鼠标进入图标种子区域
- **位置**：`position: absolute`，`left: 52px`，与对应图标垂直对齐
- **入场动画**（GSAP）：
  ```js
  gsap.fromTo(panelRef.current, 
    { x: -16, opacity: 0, scale: 0.96 },
    { x: 0, opacity: 1, scale: 1, duration: 0.38, ease: 'expo.out' }
  )
  ```
- **退场**：鼠标离开图标 + panel 整体区域后，延迟 150ms 触发：
  ```js
  gsap.to(panelRef.current, { x: -10, opacity: 0, duration: 0.22, ease: 'power2.in' })
  ```
- Panel 和图标种子共同构成一个 hover 区域（用 `onMouseLeave` 判断 `relatedTarget` 是否仍在区域内）

### 4.2 SearchModule Panel

- 宽度：280px
- 内容：复用现有 `SearchBar` 组件逻辑（输入框 + 结果列表）
- 面板打开时自动 focus 输入框

### 4.3 NavModule Panel（FlowingMenu 风格）

- 宽度：220px
- 内容：3 个导航 item（探索 / 我的库 / 设置）
- 每个 item 为全宽横条，使用改编的 FlowingMenu 动画：
  - 静态层：左对齐文字 + 当前路由高亮
  - 覆盖层（marquee）：hover 时从最近边缘（top/bottom）滑入，纯文字跑马灯（无图片）
  - 跑马灯文字：GSAP 无限循环 `x: -contentWidth`，duration 由 `speed` prop 控制（默认 12s）
  - 覆盖层背景：`var(--sm-accent)`，文字色：白色
- 点击导航至对应页面并关闭 panel

**closest-edge 检测**（复用 FlowingMenu 原版逻辑）：
```js
const findClosestEdge = (mouseX, mouseY, width, height) => {
  const top = (mouseX - width/2)**2 + mouseY**2
  const bottom = (mouseX - width/2)**2 + (mouseY - height)**2
  return top < bottom ? 'top' : 'bottom'
}
```

### 4.4 SourceModule Panel

- 宽度：160px
- 内容：两个选项按钮（网易云 / QQ音乐），复用 `SourceSwitcher` 逻辑
- 当前选中项有 accent 色高亮

### 4.5 AccountModule Panel

- 宽度：200px
- 内容：当前登录状态展示 + 登录/退出按钮
- 复用 `AccountSettings` 组件逻辑

---

## 5. 动画系统规范

### 5.1 依赖

- `gsap`（已安装，FlowingMenu 已用）
- `@gsap/react`（useGSAP hook，需安装）

### 5.2 统一动画常量

```ts
// src/lib/animation.ts
export const EASE_OUT = 'expo.out'
export const EASE_IN = 'power2.in'
export const DURATION_ENTER = 0.38
export const DURATION_LEAVE = 0.22
export const ICON_HOVER_DURATION = 0.2
```

### 5.3 useGSAP hook 用法

```tsx
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

useGSAP(() => {
  // 所有 gsap 调用在此，自动 cleanup
}, { scope: containerRef })
```

### 5.4 全局页面切换动画

`AppShell` 中 page key 变化时的动画保持现有 `pageEnter` keyframe，但增加 exit 动画（使用 GSAP `onLeave`）。

---

## 6. PlayerBar Bug 修复

**问题**：PlayerBar 使用 `position: absolute/fixed` 导致覆盖底部内容。

**修复**：
1. `PlayerBar` 改为 `position: relative`（flex 兄弟节点）
2. `AppShell` 容器的 `.shell` 加 `overflow-y: auto`
3. 页面内容组件不再需要自行 padding-bottom

---

## 7. 需要删除/重构的现有组件

| 组件 | 操作 |
|------|------|
| `TitleBar.tsx` + `.module.css` | 删除 |
| `SearchPill.tsx` + `.module.css` | 迁移逻辑到 SearchModule |
| `SourceSwitcher.tsx` | 保留逻辑，UI 在 SourceModule Panel 中复用 |
| `App.tsx` | 移除 TitleBar，新增 LeftStrip，调整布局 |
| `AppShell.tsx` | 加 overflow-y: auto |

---

## 8. 新增文件

```
src/components/Layout/LeftStrip.tsx
src/components/Layout/LeftStrip.module.css
src/components/Layout/modules/SearchModule.tsx
src/components/Layout/modules/NavModule.tsx
src/components/Layout/modules/NavModule.module.css
src/components/Layout/modules/SourceModule.tsx
src/components/Layout/modules/AccountModule.tsx
src/components/Layout/FlowingMenu/FlowingMenu.tsx
src/components/Layout/FlowingMenu/FlowingMenu.module.css
src/lib/animation.ts
```

---

## 9. 不在本次范围内

- 拖拽重排模块位置
- 多账号切换
- 模块动画偏好设置（减弱动画）
