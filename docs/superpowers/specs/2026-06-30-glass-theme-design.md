# Glass Theme — 单色玻璃风格重设计

**日期：** 2026-06-30  
**状态：** 已确认，待实施

---

## 目标

将应用整体视觉风格从「主题蓝 + 毛玻璃混用」切换为「黑白灰单色调 + 统一玻璃层级系统」，同时修复非 3D 模式下粒子渲染和音频分析未停止的性能 bug。

---

## 一、色彩 Token 系统

### 深色模式（主）

```css
:root, [data-theme="dark"] {
  /* 背景 — 纯黑灰，去掉蓝调 */
  --sm-bg-base:        #0c0c0c;
  --sm-bg-elevated:    rgba(255, 255, 255, 0.06);
  --sm-bg-overlay:     rgba(255, 255, 255, 0.10);

  /* 强调色 — 透明玻璃白，替代蓝色 */
  --sm-accent:         rgba(255, 255, 255, 0.92);
  --sm-accent-warm:    rgba(255, 255, 255, 0.70);
  --sm-text-on-accent: #0c0c0c;

  /* 文字 */
  --sm-text-primary:   rgba(255, 255, 255, 0.92);
  --sm-text-secondary: rgba(255, 255, 255, 0.45);

  /* 边框 */
  --sm-border:         rgba(255, 255, 255, 0.10);
  --sm-shadow:         0 4px 24px rgba(0, 0, 0, 0.60);

  /* 玻璃层级 blur */
  --glass-blur-base:   blur(12px);
  --glass-blur-card:   blur(18px);
  --glass-blur-modal:  blur(32px);
}
```

### 浅色模式（对称调整）

```css
:root, [data-theme="light"] {
  --sm-bg-base:        #f0f0f0;
  --sm-bg-elevated:    rgba(255, 255, 255, 0.72);
  --sm-bg-overlay:     rgba(255, 255, 255, 0.88);
  --sm-accent:         rgba(0, 0, 0, 0.85);
  --sm-accent-warm:    rgba(0, 0, 0, 0.60);
  --sm-text-on-accent: #ffffff;
  --sm-text-primary:   rgba(0, 0, 0, 0.90);
  --sm-text-secondary: rgba(0, 0, 0, 0.45);
  --sm-border:         rgba(0, 0, 0, 0.10);
  --sm-shadow:         0 4px 24px rgba(0, 0, 0, 0.12);
  --glass-blur-base:   blur(12px);
  --glass-blur-card:   blur(18px);
  --glass-blur-modal:  blur(32px);
}
```

---

## 二、Glass 层级系统

三层规范，统一替换现有各处散乱的 `backdrop-filter`：

| 层级 | 用在哪里 | blur | bg | border |
|---|---|---|---|---|
| `base` | TopBar、PlayerBar 底座 | `12px` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.10)` |
| `card` | 搜索下拉框、AvatarMenu、ShelfDetail | `18px` | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.12)` |
| `modal` | LyricsPanel、SettingsPanel | `32px` | `rgba(0,0,0,0.55)` | `rgba(255,255,255,0.08)` |

### GlassPanel 组件修改

`GlassPanel.tsx` 新增 `level?: 'base' | 'card' | 'modal'` prop（默认 `'base'`），对应三套 CSS class。所有目前分散写 `backdrop-filter` 的位置全部替换为 `<GlassPanel level="...">` 或对应 token。

**性能约束：** 同一视图内最多同时激活 2 层 `backdrop-filter`。LyricsPanel（`modal`）开启时，PlayerBar 的 blur 降为 0（`backdrop-filter: none`）。

---

## 三、TopBar 透明化

TopBar 去掉背景色和底部边框，导航元素（返回按钮、Tab、搜索框、头像）直接浮在主内容背景之上：

```css
/* TopBar.module.css */
.bar {
  background: transparent;
  border-bottom: none;
  /* 保留 height、padding、-webkit-app-region: drag */
}
```

搜索框 hover/focus 时用 `glass-card` 层级浮出（`backdrop-filter: blur(18px)`），平时几乎隐形。整个 `AppShell` 根背景设为 `#0c0c0c`，面板叠在其上，从上到下形成连续深黑玻璃。

---

## 四、交互元素玻璃发光

### 纯 CSS 轻量版（按钮、Tab、Toggle、Slider）

不挂 JS 事件，通过 `:hover` / `:focus-visible` 伪类实现：

```css
/* 通用交互状态 */
background: rgba(255, 255, 255, 0.10);
border: 1px solid rgba(255, 255, 255, 0.22);
box-shadow: 0 0 8px rgba(255, 255, 255, 0.10),
            inset 0 0 0 1px rgba(255, 255, 255, 0.08);
```

播放按钮：白色玻璃圆 + 黑色图标 + `box-shadow: 0 0 16px rgba(255,255,255,0.30)`，替换现有蓝色。

Tab 激活态：`color: rgba(255,255,255,0.92)`，下方加 `2px` 白色指示线，替换现有 `--sm-accent` 蓝色。

Toggle 开启态：白色滑轨 + 黑色拇指，替换蓝色背景。

Slider 滑块：白色圆点 + `box-shadow: 0 0 8px rgba(255,255,255,0.50)`。

### JS BorderGlow 版（大卡片）

仅用于 `PlaylistCard`、`ShelfCard`、`HeroBanner` 三处。引入 React Bits BorderGlow 组件，单色参数：

```jsx
<BorderGlow
  glowColor="0 0 95"
  backgroundColor="rgba(255,255,255,0.05)"
  colors={['#ffffff', '#cccccc', '#888888']}
  glowIntensity={0.7}
  edgeSensitivity={35}
  animated={false}
>
```

**节流：** `onPointerMove` 内用 `requestAnimationFrame` 限频（≤16ms/帧），通过 `IntersectionObserver` 在卡片离开视口时自动解绑。

---

## 五、性能修复

### 粒子渲染 + 音频分析按需启停

`LyricsPanel.tsx` 改为条件渲染：

```tsx
{mode === '3d' && <Scene className={styles.scene3d} />}
```

React 卸载 `<Canvas>` 时，`@react-three/fiber` 自动销毁 WebGL context 和 `useFrame` 循环，`getFrequencyData()` 随之停止，无需额外清理。

### WebGL 参数降级

`Scene.tsx` 修改：

```tsx
<Canvas
  dpr={[1, 1.5]}          // 原 [1, 2]，Retina 下减少 GPU 填充
  gl={{ antialias: false, alpha: true }}  // 粒子云不需要抗锯齿
>
```

---

## 六、改动范围

### Group 1 — Token & 全局基础（优先级最高）
- `src/styles/tokens.css`
- `src/styles/global.css`
- `src/components/ui/GlassPanel.tsx`
- `src/components/ui/GlassPanel.module.css`

### Group 2 — Layout
- `src/components/Layout/TopBar.module.css`
- `src/components/Layout/AppShell.module.css`
- `src/components/Layout/AvatarMenu.module.css`

### Group 3 — 交互元素
- `src/components/ui/Slider.module.css`
- `src/components/ui/Toggle.module.css`
- `src/components/Player/PlayerBar.module.css`

### Group 4 — 卡片 BorderGlow
- `src/components/BorderGlow/BorderGlow.tsx`（新增）
- `src/components/BorderGlow/BorderGlow.css`（新增）
- `src/components/Explore/PlaylistCard.tsx`
- `src/components/Shelf/ShelfCard.tsx`
- `src/components/Explore/HeroBanner.tsx`

### Group 5 — 性能修复
- `src/components/Lyrics/LyricsPanel.tsx`
- `src/components/Visualizer/Scene.tsx`

**不改：** 歌词渲染逻辑、路由、Zustand store、Electron 主进程、音频引擎

---

## 验收标准

1. 应用内所有蓝色（`#4a90d9`、`#5da3f0`、`#6ea8ff`）已消除
2. TopBar 在视觉上无明显边界，与主内容背景无缝连接
3. PlaylistCard / ShelfCard / HeroBanner 有边缘发光效果（鼠标靠近触发）
4. 普通歌词模式下 Activity Monitor 中 GPU Process 占用明显下降
5. 所有 `backdrop-filter` 使用 token 中的三个层级之一，无自定义 blur 值散落
