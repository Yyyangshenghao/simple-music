# 歌词页沉浸式自动隐藏 + Apple Music 式左右布局 — 设计

日期:2026-07-07
状态:已确认

## 背景

当前歌词页(`src/components/Lyrics/LyricsPanel.tsx`)为上下布局:header(收起按钮 + 歌词/3D 切换)→ 黑胶旋转封面 + 歌名/歌手 → 歌词滚动区。播放栏是独立悬浮 dock(`PlayerGlass`,z-index 210),常驻盖在歌词页(z-index 200)上方。缺少沉浸模式,且布局与 Apple Music mac 端的左右分栏体验差距较大。

## 需求

1. **沉浸式自动隐藏**:歌词页打开时,鼠标 3 秒无操作,自动淡出播放栏、收起按钮、歌词/3D 切换按钮,并隐藏鼠标指针;鼠标一动立即恢复。
2. **左右布局**:纯歌词模式改为左侧封面 + 歌名 + 歌手,右侧歌词,参考 Apple Music mac 端。

## 已确认的决策

- 空闲时长:**3 秒**。
- 封面形态:**大圆角方形**,不旋转,移除黑胶中心孔(仅歌词页;PlayerBar 缩略图不动)。
- 隐藏行为:**只淡出,布局不动**;歌词区域位置不变,无跳动。
- 3D 模式:**保持现状**(全屏场景 + 底部歌词叠加);自动隐藏对两种模式都生效,左右布局仅纯歌词模式。

## 方案

### 1. 自动隐藏(useIdleHide)

- 新增 `src/hooks/useIdleHide.ts`:`useIdleHide(enabled: boolean, timeoutMs = 3000): boolean`。
  - `enabled` 为 true 时在 `window` 上监听 `mousemove` / `mousedown` / `keydown`,重置 3s 定时器;超时置 idle。
  - `enabled` 为 false 时清理监听与定时器,恒返回 false。
- `App.tsx`:`const controlsHidden = useIdleHide(lyricsOpen)`,分别传给 `PlayerBar`(→ `PlayerGlass`)与 `LyricsPanel`。不新增 store。
- 表现(CSS 类切换,过渡约 0.4s,沿用 tokens 缓动):
  - `PlayerGlass` dock:`opacity: 0` + `pointer-events: none`(可附带轻微 `translateY` 下沉)。
  - `LyricsPanel` header(收起按钮 + 模式切换):同样淡出并禁用指针事件。
  - 歌词页根节点加 `cursor: none`。
- 鼠标移动立即淡入恢复。

### 2. 左右布局(仅 lyrics 模式)

- `LyricsPanel` 歌词模式内容改为两栏容器:
  - **左栏**(约 40% 宽,垂直居中):大圆角方形封面 `clamp(240px, 26vw, 340px)`,`border-radius` 约 16–20px,层次阴影;下方歌名 + 歌手(左栏内居中)。
  - **右栏**:歌词滚动区,文字**左对齐**(`LyricLine` / `KtvLine` 在歌词页内的对齐方式随之调整,3D 叠加层保持居中),保留上下渐隐 mask、当前行居中滚动、KTV 逐字渲染逻辑。
- 保留:封面模糊背景、氛围霞光舞台、空状态"暂无歌词"、3D 模式全部现状。
- 响应式兜底:窗口宽度 `< 900px` 时回退为上下布局(封面缩小居中,歌词在下)。

## 涉及文件

- `src/hooks/useIdleHide.ts`(新增)
- `src/App.tsx`(接线)
- `src/components/Player/PlayerBar.tsx` / `PlayerGlass.tsx` / `PlayerGlass.module.css`(hidden prop + 淡出样式)
- `src/components/Lyrics/LyricsPanel.tsx` / `LyricsPanel.module.css`(header 淡出 + 左右布局)
- 视对齐实现方式可能微调 `LyricLine.module.css` / `KtvLine.module.css`

## 验证

- `npm run typecheck` + `npm test`。
- 手动/实测:打开歌词页静置 3s 观察淡出与指针隐藏,移动鼠标恢复;两种模式均验证;窄窗口回退布局;关闭歌词页后播放栏不受 idle 影响。
