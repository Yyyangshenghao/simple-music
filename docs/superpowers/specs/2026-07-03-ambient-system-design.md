# 全局氛围系统（暗夜霞光 · 第一期）设计

日期：2026-07-03
状态：已确认

## 背景与目标

App 整体视觉偏模板化、动画不足。整体升级定为「暗夜霞光」方向：深色底、封面取色驱动的动态霞光、玻璃质感、大胆但统一的动效。全项目分四期：

1. **第一期 · 全局氛围系统（本 spec）**
2. 第二期 · 内容区（卡片/列表动效：TiltedCard/SpotlightCard/AnimatedList 风格）
3. 第三期 · 页面转场（共享元素过渡，基于已有 motion 依赖）
4. 第四期 · 播放器体验（PlayerBar 音频响应辉光、歌词页舞台化）

第一期目标：**每换一首歌，整个 app 的底色氛围随封面平滑变色**，并建立后续各期共用的光效 token 与动效预设。

## 范围

**做**：氛围 store、调色板提取、CSS 变量接线、LiquidEther 背景跟色与性能/互斥规则、光效 token、ClickSpark 全局点击迸发、统一动效预设（应用到 TopBar/AvatarMenu/Settings 等全局组件）。

**不做**：页面内容区布局、页面转场、PlayerBar 视觉改造（二/三/四期）。

## 架构

### 1. 氛围 store（新增 `src/stores/ambient.ts`）

- 状态：`palette: [string, string, string]` — 主色/副色/点缀色，来自当前歌曲封面
- 默认调色板（无歌曲/提取失败时）：现有紫粉霞光 `['#5227FF', '#FF9FFC', '#B497CF']`
- 动作：`setPalette(palette)`、`resetPalette()`
- 音频能量字段留给第四期（音频响应辉光）再加，本期背景强度只联动播放/暂停状态

### 2. 调色板提取（扩展 `src/lib/extract-color.ts`）

- 新增 `extractPalette(img: HTMLImageElement): [string, string, string]`：
  - 缩样到小尺寸（如 24×24），做简单色彩量化（HSL 桶分组），取出现频率最高的 2–3 个主导色
  - 饱和度/亮度修正：饱和度过低的色向默认霞光色偏移，亮度钳制在深色底上可读的区间，避免灰棕浑浊
  - 任何异常返回默认调色板，不抛错
- 原 `extractColor` 保持不动（HeroBanner/ArtistHeader 仍在使用）

### 3. 接线 hook（新增 `src/hooks/useAmbientPalette.ts`，挂在 App）

- 监听 `usePlayerStore.currentTrack.cover`：
  - 经 `api.url('/proxy/cover', { url })` 加载图片（`crossOrigin='anonymous'`）
  - `extractPalette` → 写入 ambient store
  - 同步把 `--ambient-1/2/3` 写到 `document.documentElement`，CSS 侧用 `transition` 做约 800ms 平滑过渡（渐变/辉光引用变量处生效）
- 无封面或加载失败 → `resetPalette()`

### 4. 背景层（改造 `AppShell` 的 LiquidEther 用法）

- `colors` 从写死的三色改为订阅 ambient store 的 palette
- 播放状态联动：播放中 `autoSpeed`/`autoIntensity` 略升，暂停时回落（缓动，不跳变）
- 性能规则（接入现有 `PerformanceMode`）：
  - `eco`：不渲染 WebGL，退化为 CSS 渐变霞光层（引用 `--ambient-*`，缓慢 hue 漂移动画）
  - `balanced`：保持 `resolution: 0.4`
  - `high` / `ultra`：`resolution: 0.5`
- 互斥/暂停规则：
  - LyricsPanel 3D 粒子模式打开时暂停背景渲染（同屏只跑一个全屏 WebGL 层）
  - `document.hidden` 时暂停

## 光效 Token（扩展 `src/styles/tokens.css`）

新增一组独立 token，现有玻璃体系不动：

- `--ambient-1/2/3`：氛围三色，CSS 给默认值，hook 动态覆盖
- `--glow-soft`：卡片辉光阴影（基于 `--ambient-1` 的低透明度大模糊 box-shadow）
- `--glow-ring`：活跃元素边缘光
- `--ambient-gradient`：霞光渐变（linear-gradient 三色），供渐变文字/边框使用
- 浅色模式：辉光透明度减半，避免刺眼

## 全局微交互

### ClickSpark（新增 `src/components/ui/ClickSpark.tsx`）

- 参照 React Bits click-spark：单个全屏 canvas 覆盖层（`pointer-events: none`，挂在 App 最外层）
- 每次点击在点击处迸发 8 条短线火花，颜色取 `--ambient-1`，时长约 400ms
- 无第三方依赖；`prefers-reduced-motion` 时禁用

### 统一动效预设（新增 `src/lib/motion-presets.ts`）

- 导出统一弹簧参数与 variants：
  - `springSnappy`：按钮按压 scale 0.96 回弹
  - `hoverLift`：卡片上浮 + 辉光渐显
  - `fadeRise`：入场淡入上移
- 第一期应用到 TopBar 按钮、AvatarMenu、Settings 控件；后续各期直接复用，保证手感一致

## 错误处理

- 调色板提取失败（跨域、空图、解码失败）→ 回退默认霞光色，静默
- 封面加载竞态：切歌时取消上一次的提取结果（以最新 track 为准）
- eco 档 / reduced-motion：所有新增动效有降级路径

## 测试

- 单测（vitest）：
  - `extractPalette`：构造 ImageData 验证主导色提取、饱和度修正边界、异常回退
  - ambient store：setPalette/resetPalette/energy 状态流转
- 回归：跑现有全量测试 + typecheck + build
- 手动验收：切歌观察背景约 800ms 平滑变色；eco 档退化为 CSS 渐变；歌词页 3D 打开时背景暂停；浅色模式辉光减弱

## 参考

- React Bits：click-spark、aurora/soft-aurora（氛围参考）、liquid-ether（已引入）
- 已有基建：`extract-color.ts`、`PerformanceMode`（visual store）、glass token 体系、motion 依赖
