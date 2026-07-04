# 播放器体验（暗夜霞光 · 第四期 · 收官）设计

日期：2026-07-04
状态：已确认（用户指示继续，按提案推进）

## 背景与目标

四期计划收官。一~三期已交付氛围系统、内容区动效、页面转场。本期把「音乐在响」变成可见的：播放栏随节拍发光、歌词页霞光舞台化，并偿还一期（播放/暂停背景缓动、音频能量）与三期（lazy 预热、TiltCard reduced-motion）移交的技术债。

## 范围

**做**：音频能量纯函数 + `useAudioEnergy` hook、PlayerGlass 音频响应辉光、PlayerBar 按钮弹簧按压、歌词页 lyrics 模式霞光舞台 + 当前行光晕、AppShell 播放缓动弹簧、lazy 页面预热、TiltCard `useReducedMotion()`。

**不做**：歌词 3D 模式、桌面歌词、KTV 解析逻辑；新增依赖。

## 设计

### 1. 音频能量（新增 `src/lib/audio-energy.ts` + `src/hooks/useAudioEnergy.ts`）

- 纯函数（node 可单测，TDD）：
  - `bassEnergyFrom(data: Uint8Array | number[]): number` — 前 16 个 bin 平均 / 255（与 CoverParticleCloud 现有取法一致）
  - `smoothEnergy(prev: number, next: number): number` — 指数平滑，上升快（k=0.35）下降慢（k=0.08），有节拍感不抖动
- hook `useAudioEnergy(ref: RefObject<HTMLElement>)`：`status === 'playing'` 且 `performanceMode !== 'eco'` 时启动 rAF，每帧读 `usePlayerStore.getState()._engine().getFrequencyData()` → 平滑 → 写目标元素 `--audio-energy`（0–1）；停止播放/eco 时停表并归零

### 2. PlayerGlass 音频响应辉光（改 `PlayerGlass.tsx` + `.module.css`）

- dock 挂 `useAudioEnergy`；GlassPanel 之前插入 `.glow` 层：底部升起的氛围色 radial 光晕（`--ambient-1/2` color-mix），`opacity: calc(var(--audio-energy, 0) * 0.85)`，blur 24px，pointer-events none
- eco/暂停时 `--audio-energy` 为 0 → 辉光不可见，零开销

### 3. PlayerBar 按钮弹簧（改 `PlayerBar.tsx`）

- 上一首/播放暂停/下一首三个按钮换 `motion.button` + `whileTap={tapScale}` + `springSnappy`，其余 props 不动

### 4. 歌词页霞光舞台（改 `LyricsPanel.tsx` + `.module.css`、`KtvLine.module.css`、`LyricLine.module.css`）

- lyrics 模式：blurBg 之后插入 `.auroraStage` 层——两团 `--ambient-1/2` radial 霞光缓慢漂移（30s alternate），层叠位置与 blurBg 相同（沿用其 z-index 处理），内容不受影响
- 当前行光晕：KtvLine 与 LyricLine 的 `.active` 追加 `text-shadow: 0 0 24px color-mix(in srgb, var(--ambient-2) 55%, transparent)`

### 5. AppShell 播放缓动（一期移交；改 `AppShell.tsx`）

- 单一弹簧 `playAmount`（motion `useSpring` + `gentleSpringValues`）：播放→1、暂停→0；`useMotionValueEvent` 同步到 state
- `autoSpeed = 0.25 + 0.2 × amount`、`autoIntensity = 1.2 + 0.6 × amount`（端点值与现状一致），播放↔暂停平滑过渡不跳变

### 6. 收尾清理（三期移交）

- AppShell 挂载 2s 后空闲预热四个 lazy 页面模块（`import()`），首次切页转场不再被 chunk 加载吞掉
- TiltCard：模块级 `REDUCED_MOTION` 快照改为 `useReducedMotion()`（motion/react），响应运行时切换

## 测试

- 单测（TDD）：`bassEnergyFrom`（空数组 0、全 255 → 1、部分数据）、`smoothEnergy`（上升快/下降慢、收敛）
- 回归：typecheck + 全量测试 + build
- 手动验收：播放时底栏辉光随节拍呼吸、暂停渐熄；歌词页霞光漂移、当前行光晕、切歌变色；播放/暂停背景流速平滑过渡；首次切页转场完整；系统切「减弱动态」TiltCard 立即停倾斜

## 参考

- 现有 `audio-engine.getFrequencyData()`、CoverParticleCloud 的 bassEnergy 取法
- 一期移交：播放/暂停缓动、音频能量；三期移交：lazy 预热、TiltCard useReducedMotion
