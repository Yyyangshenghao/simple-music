# 3D 歌词模式界面优化 — 设计文档

日期:2026-07-12
范围:`src/components/Lyrics/LyricsPanel.tsx(.module.css)`、`src/components/Lyrics/EffectSwitcher.tsx(.module.css)`
不新增依赖;动效沿用 `src/lib/motion-presets.ts`,视觉变量沿用 `src/styles/tokens.css`(`--glass-*`/`--glow-*`/`--sm-*`)。

## 背景

歌词面板 3D 模式(`mode === '3d'`)现状:

- Canvas 只占 header 以下、面板底部 124px 留白以上的中段,上下与深色面板底形成明显"断层"。
- 底部歌词叠加层在无逐字歌词(纯 LRC)时永远显示占位符"—"。
- 效果切换器是 3 个裸图标按钮,不看 tooltip 无法知道效果名。
- 3D 模式下看不到任何曲目信息(歌名/歌手/封面)。

## 设计

### 1. 场景全出血(核心布局改动)

- 面板在 3D 模式下加 `mode3d` 类:去掉 `padding-bottom: 124px`。
- `.scene3d` 改为 `position: absolute; inset: 0`,Canvas 铺满整个面板,延伸到 header 后面与悬浮播放栏后面。
- header 保持现有 DOM 位置(仍承担窗口拖拽区),悬浮于场景之上;3D 模式下场景顶部加向下渐变(透明 → 场景),保证 header 控件可读。
- 歌词叠加层 `bottom` 内边距抬高到悬浮播放栏(≈120px)之上,底部渐变延伸到面板最底,视觉上与播放栏区域连续。

### 2. 歌词叠加层

- **纯 LRC 回退**:`currentWordLine` 不存在但 `lines[currentIndex]` 存在时,渲染整行文本 + 翻译(样式与 KTV 行一致);两者都没有才显示占位符。
- **切行动效**:当前行/下一行用 `AnimatePresence`(按行号 key)做 fadeRise 淡入上移;退出行淡出。
- **排版**:当前行字号 `clamp(24px, 3vw, 38px)`;文字加轻微 text-shadow,提升亮色粒子背景下可读性。

### 3. 效果切换器

- iOS 展开式 segmented:选中项展开为"图标 + 名称"(motion `layout` 动画),未选中仅图标。
- 选中态用 `--glow-*` token 加辉光。
- 保留顶部居中悬浮胶囊、沉浸模式(`controlsHidden`)淡出。

### 4. 曲目信息区

- 场景左下角(歌词叠加层左上方、不与其重叠)加玻璃卡片:小封面缩略图 + 歌名 + 歌手(复用 `ArtistLinks`,可点击跳转,跳转前 `onClose`)。
- 样式用 `--glass-bg-card`/`--glass-border-card`;沉浸模式随控件一起淡出。

### 5. 整体氛围

- 场景四周加 CSS vignette 暗角(radial-gradient 叠加层,不进 WebGL),让 3D 内容与面板边缘融合。
- 切换效果时对 Canvas 容器按 effect key 做淡入过渡(容器 opacity,motion 动画),避免效果硬切。

## 错误处理 / 边界

- 无歌词(`lines` 为空):叠加层只显示占位符,不渲染回退行。
- 无封面:曲目信息卡缩略图显示"♪"占位(复用现有 coverPlaceholder 思路的小号版)。
- 窄窗口(<900px):曲目信息卡与效果切换器不重叠——切换器保持顶部居中,信息卡宽度收缩、歌名省略号截断。
- 同屏仅一个 WebGL 场景的约定不受影响(仍只有一个 Canvas)。

## 验证

- `npm run typecheck` + `npm test` 通过。
- 手动:三种效果下检查全出血无断层、纯 LRC 歌曲叠加层正常显示、切行动效、切换器展开动画、沉浸模式全部控件淡出、窄窗口不重叠。
