# 3D 歌词模式界面优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 歌词面板 3D 模式场景全出血消除上下断层,叠加层支持纯 LRC 回退与切行动效,效果切换器升级为展开式,新增左下角曲目信息卡与整体氛围融合。

**Architecture:** 全部改动集中在渲染层两组组件:`LyricsPanel`(布局/叠加层/信息卡/氛围)与 `EffectSwitcher`(展开式选中态)。`.scene3d` 从 flex 子项改为 `absolute inset: 0` 铺满面板实现全出血;其余为 CSS Modules + motion 动效增量。

**Tech Stack:** React + CSS Modules + motion/react(动效沿用 `src/lib/motion-presets.ts`),视觉变量沿用 `src/styles/tokens.css`。

**Spec:** `docs/superpowers/specs/2026-07-12-lyrics-3d-ui-polish-design.md`

## Global Constraints

- 不新增任何依赖。
- 动效统一引用 `src/lib/motion-presets.ts`(springSnappy/springGentle/tapScale),视觉变量用 tokens.css 的 `--glass-*`/`--glow-*`/`--sm-*`,不写魔法数值(布局尺寸除外)。
- 样式用 CSS Modules,与组件同目录。
- 同屏只跑一个 WebGL 场景(本计划不新增 Canvas)。
- 本计划为纯视觉/布局改动,仓库无组件测试基建(测试均为 lib 层 `*.test.ts`),不为此引入 jsdom;每个任务的验证 = `npm run typecheck` + `npm test`(回归)+ 最终人工核验。
- 提交信息结尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 场景全出血 + vignette + 切换器下移

**Files:**
- Modify: `src/components/Lyrics/LyricsPanel.module.css`(`.scene3d`、`.lyricsOverlay`,新增 `.sceneTopFade`/`.sceneVignette`)
- Modify: `src/components/Lyrics/LyricsPanel.tsx`(3D 分支加两个氛围 div)
- Modify: `src/components/Lyrics/EffectSwitcher.module.css`(`.switcher` 位置)

**Interfaces:**
- Consumes: 现有 `.scene3d`/`.lyricsOverlay` 结构(LyricsPanel.tsx 3D 分支)。
- Produces: `.scene3d` 变为覆盖整个面板的绝对定位容器;后续任务(信息卡、淡入层)都挂在 `.scene3d` 内。

- [ ] **Step 1: 修改 LyricsPanel.module.css 布局**

`.scene3d` 由 flex 子项改为绝对定位铺满面板(header 仍在 flex 流中、z-index 2 悬浮其上;面板的 124px 底部留白只影响 flex 子项,不再截断场景):

```css
/* 3D 场景容器：全出血铺满面板（header 与悬浮播放栏之后） */
.scene3d {
  position: absolute;
  inset: 0;
}
```

`.lyricsOverlay` 的底部内边距抬高到悬浮播放栏(≈120px)之上,渐变延伸到面板最底:

```css
  padding: 32px 48px 148px;
```

(替换原 `padding: 32px 48px 48px;`,其余属性不动。)

在 3D 段落追加两个氛围层(放在 `.lyricsOverlay` 规则之前):

```css
/* 顶部渐变：保证悬浮 header 控件在亮色粒子上可读 */
.sceneTopFade {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 140px;
  z-index: 1;
  background: linear-gradient(to bottom, rgba(4, 6, 12, 0.66) 0%, transparent 100%);
  pointer-events: none;
}

/* 四周暗角：让 3D 场景与面板边缘融合 */
.sceneVignette {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: radial-gradient(120% 90% at 50% 45%, transparent 62%, rgba(4, 6, 12, 0.5) 100%);
  pointer-events: none;
}
```

- [ ] **Step 2: LyricsPanel.tsx 3D 分支挂氛围层**

在 `<Canvas>…</Canvas>` 之后、`<EffectSwitcher …/>` 之前插入:

```tsx
          <div className={styles.sceneTopFade} aria-hidden="true" />
          <div className={styles.sceneVignette} aria-hidden="true" />
```

- [ ] **Step 3: 效果切换器避开 header**

场景全出血后切换器 `top: 16px` 会与 header(约 90px 高,含 macOS 红绿灯区)重叠。EffectSwitcher.module.css `.switcher` 中:

```css
  top: 104px;
  -webkit-app-region: no-drag;
```

(替换原 `top: 16px;`,并追加 no-drag 防止落入窗口拖拽区。)

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm test`
Expected: 两者均通过(无新增测试,回归不破)。

- [ ] **Step 5: Commit**

```bash
git add src/components/Lyrics/LyricsPanel.module.css src/components/Lyrics/LyricsPanel.tsx src/components/Lyrics/EffectSwitcher.module.css
git commit -m "feat: 3D 歌词场景全出血,消除 header 与底部播放栏断层

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 歌词叠加层 — 纯 LRC 回退 + 切行动效 + 排版

**Files:**
- Modify: `src/components/Lyrics/LyricsPanel.tsx`(叠加层 JSX)
- Modify: `src/components/Lyrics/LyricsPanel.module.css`(`.overlayCurrentLine`)

**Interfaces:**
- Consumes: `useLyricsStore` 的 `lines`/`wordLines`/`translation`/`currentIndex`;`KtvLine`(props: words/lineDurationMs/lineStartMs/active/translationText)、`LyricLine`(props: text/translation/active)。
- Produces: 叠加层在三种数据形态下的渲染:逐字(KtvLine)→ 纯 LRC(LyricLine)→ 无歌词(占位符)。

- [ ] **Step 1: LyricsPanel.tsx 引入 motion 并补纯 LRC 数据**

顶部 import 增加:

```tsx
import { AnimatePresence, motion } from 'motion/react'
import { springGentle } from '../../lib/motion-presets'
```

在 `const nextTranslation = …` 之后补两行:

```tsx
  const currentPlainLine = currentIndex >= 0 ? lines[currentIndex] : undefined
  const nextPlainLine = currentIndex >= 0 ? lines[currentIndex + 1] : undefined
```

- [ ] **Step 2: 重写叠加层 JSX**

将 `<div className={styles.lyricsOverlay}>…</div>` 整块替换为:

```tsx
          <div className={styles.lyricsOverlay}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={currentIndex}
                className={styles.overlayCurrentLine}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={springGentle}
              >
                {currentWordLine ? (
                  <KtvLine
                    words={currentWordLine.words}
                    lineDurationMs={currentWordLine.durationMs}
                    lineStartMs={currentWordLine.time * 1000}
                    active={true}
                    translationText={translation[currentIndex]?.text || undefined}
                  />
                ) : currentPlainLine ? (
                  <LyricLine
                    text={currentPlainLine.text}
                    translation={translation[currentIndex]?.text || undefined}
                    active={true}
                  />
                ) : (
                  <div className={styles.overlayPlaceholder}>—</div>
                )}
              </motion.div>
            </AnimatePresence>
            {(nextWordLine || nextPlainLine) && (
              <div className={styles.overlayNextLine}>
                {nextWordLine ? (
                  <KtvLine
                    words={nextWordLine.words}
                    lineDurationMs={nextWordLine.durationMs}
                    lineStartMs={nextWordLine.time * 1000}
                    active={false}
                    dim={false}
                    translationText={nextTranslation || undefined}
                  />
                ) : (
                  <LyricLine
                    text={nextPlainLine!.text}
                    translation={nextTranslation || undefined}
                    active={false}
                  />
                )}
              </div>
            )}
          </div>
```

- [ ] **Step 3: 排版增强(LyricsPanel.module.css)**

`.overlayCurrentLine` 改为:

```css
.overlayCurrentLine {
  font-size: clamp(24px, 3vw, 38px);
  font-weight: 700;
  text-align: center;
  width: 100%;
  max-width: 700px;
  text-shadow: 0 2px 24px rgba(0, 0, 0, 0.55);
}
```

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm test`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/Lyrics/LyricsPanel.tsx src/components/Lyrics/LyricsPanel.module.css
git commit -m "feat: 3D 歌词叠加层支持纯 LRC 回退,切行淡入动效与排版增强

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 效果切换器展开式选中态 + 切换效果淡入

**Files:**
- Modify: `src/components/Lyrics/EffectSwitcher.tsx`
- Modify: `src/components/Lyrics/EffectSwitcher.module.css`
- Modify: `src/components/Lyrics/LyricsPanel.tsx`(effectFade 层)
- Modify: `src/components/Lyrics/LyricsPanel.module.css`(`.effectFade`)

**Interfaces:**
- Consumes: `useSettingsStore` 的 `lyrics3dEffect`/`setLyrics3dEffect`;Task 1 的全出血 `.scene3d`。
- Produces: 无对外接口变化(`EffectSwitcher` props 不变)。

- [ ] **Step 1: EffectSwitcher.tsx 改为展开式**

将组件返回值替换为(imports 增加 `AnimatePresence`、`tapScale`):

```tsx
import { AnimatePresence, motion } from 'motion/react'
import { springSnappy, springGentle, tapScale } from '../../lib/motion-presets'
```

```tsx
export function EffectSwitcher({ hidden }: EffectSwitcherProps) {
  const active = useSettingsStore((s) => s.lyrics3dEffect)
  const setEffect = useSettingsStore((s) => s.setLyrics3dEffect)

  return (
    <motion.div
      className={`${styles.switcher}${hidden ? ` ${styles.hidden}` : ''}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springGentle}
    >
      {EFFECTS.map((eff) => {
        const isActive = active === eff.id
        return (
          <motion.button
            key={eff.id}
            layout
            className={`${styles.btn}${isActive ? ` ${styles.active}` : ''}`}
            onClick={() => setEffect(eff.id)}
            title={eff.label}
            aria-label={eff.label}
            whileTap={tapScale}
            transition={springSnappy}
          >
            <span className={styles.icon}>{eff.icon}</span>
            <AnimatePresence initial={false}>
              {isActive && (
                <motion.span
                  className={styles.label}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.18, delay: 0.08 } }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                >
                  {eff.label}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        )
      })}
    </motion.div>
  )
}
```

(原先包着 icon 的 `motion.span whileTap` 移除,按压反馈上移到按钮本体。)

- [ ] **Step 2: EffectSwitcher.module.css 按钮改胶囊展开**

`.btn`/`.active` 替换为:

```css
.btn {
  height: 34px;
  border-radius: var(--sm-radius-pill);
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  transition: background 0.18s ease, color 0.18s ease;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
}

.active {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  padding: 0 14px 0 10px;
  box-shadow: var(--glow-ring);
}

.active:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.label {
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.4px;
  white-space: nowrap;
}
```

(删除原 `.btn:active { transform: scale(0.92); }`,按压由 whileTap 承担;`.icon` 规则保留。)

- [ ] **Step 3: 切换效果淡入层(LyricsPanel)**

LyricsPanel.tsx 中 `<div className={styles.sceneVignette} …/>` 之后插入(按 effect key 重挂,从场景底色淡出,不触碰 WebGL):

```tsx
          <motion.div
            key={lyrics3dEffect}
            className={styles.effectFade}
            style={{ background: backgroundColor || '#04060c' }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            aria-hidden="true"
          />
```

LyricsPanel.module.css 追加:

```css
/* 切换 3D 效果时的整幕淡入过渡层 */
.effectFade {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
```

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm test`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/Lyrics/EffectSwitcher.tsx src/components/Lyrics/EffectSwitcher.module.css src/components/Lyrics/LyricsPanel.tsx src/components/Lyrics/LyricsPanel.module.css
git commit -m "feat: 3D 效果切换器展开式选中态,切换效果整幕淡入

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 左下角曲目信息卡 + 人工核验

**Files:**
- Modify: `src/components/Lyrics/LyricsPanel.tsx`(信息卡 JSX)
- Modify: `src/components/Lyrics/LyricsPanel.module.css`(`.trackChip*` 一组样式)

**Interfaces:**
- Consumes: `usePlayerStore` 的 `currentTrack`;`ArtistLinks`(props: artists/fallback/source/className/onBeforeNavigate);Task 1 的 `.scene3d`。
- Produces: 无对外接口变化。

- [ ] **Step 1: LyricsPanel.tsx 3D 分支加信息卡**

在 `<EffectSwitcher hidden={controlsHidden} />` 之后插入:

```tsx
          {/* 曲目信息卡（左下角,沉浸模式淡出） */}
          <div className={`${styles.trackChip}${controlsHidden ? ` ${styles.trackChipHidden}` : ''} no-drag`}>
            {track?.cover ? (
              <img className={styles.trackChipCover} src={track.cover} alt="" draggable={false} />
            ) : (
              <div className={`${styles.trackChipCover} ${styles.trackChipCoverPlaceholder}`} aria-hidden="true">♪</div>
            )}
            <div className={styles.trackChipMeta}>
              <div className={styles.trackChipName} title={track?.name}>
                {track?.name ?? '未在播放'}
              </div>
              <ArtistLinks
                className={styles.trackChipArtist}
                artists={track?.artists}
                fallback={track?.artist ?? '—'}
                source={track?.source ?? 'netease'}
                onBeforeNavigate={onClose}
              />
            </div>
          </div>
```

- [ ] **Step 2: LyricsPanel.module.css 追加样式**

```css
/* 曲目信息卡（3D 模式左下角） */
.trackChip {
  position: absolute;
  left: 24px;
  bottom: 140px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px 10px 10px;
  max-width: min(320px, 34vw);
  background: var(--glass-bg-card);
  border: 1px solid var(--glass-border-card);
  border-radius: 16px;
  backdrop-filter: var(--glass-blur-card);
  -webkit-backdrop-filter: var(--glass-blur-card);
  pointer-events: auto;
  transition: opacity 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.trackChipHidden {
  opacity: 0;
  pointer-events: none;
}

.trackChipCover {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
}

.trackChipCoverPlaceholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.trackChipMeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.trackChipName {
  font-size: 13.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trackChipArtist {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm test`
Expected: 通过。

- [ ] **Step 4: 人工核验(整个计划的最终验证)**

Run: `npm run dev`,进入歌词面板切到 3D 模式,核对:
1. 三种效果下场景铺满整个面板,header 后与底部播放栏后均无断层;
2. 逐字歌曲切行有淡入动效;找一首纯 LRC 歌曲确认叠加层显示整行而非"—";
3. 切换器选中项展开显示名称,切换效果时整幕淡入;
4. 左下角信息卡显示封面/歌名/歌手,点歌手能收起面板并跳转;
5. 沉浸模式(controlsHidden)下 header、切换器、信息卡全部淡出;
6. 窗口缩窄(<900px)信息卡收缩截断,不与歌词/切换器重叠。

- [ ] **Step 5: Commit**

```bash
git add src/components/Lyrics/LyricsPanel.tsx src/components/Lyrics/LyricsPanel.module.css
git commit -m "feat: 3D 歌词模式左下角新增曲目信息卡

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
