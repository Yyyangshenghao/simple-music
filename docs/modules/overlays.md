# 悬浮窗(`overlays/`)

三个独立 BrowserWindow 渲染入口,由 electron.vite.config.ts 的 renderer.input 注册多页构建,复用 `src/` 的组件与 store,通过 `electron/preload/overlay.ts` 暴露的 `window.desktopOverlay` 与主进程通信。窗口生命周期与定位由 `electron/modules/overlay-manager.ts` 管理(含显示器变化时重定位)。

## desktop-lyrics(桌面歌词)

`overlays/desktop-lyrics/index.tsx` + `desktop-lyrics.html`。渲染 `src/components/Lyrics/DesktopLyrics.tsx`。

- 数据流:主窗口 `useDesktopLyricsSync` → `lyrics:update` IPC → overlay-manager 缓存并转发 → `overlay.onLyricsState` 收 `LyricsPayload`。
- 自身交互(拖动/锁定/穿透)走 `overlay:lyrics-*` 通道:set-dragging、move-by、set-lock、set-hot-bounds(热区,配合鼠标穿透)、set-pointer-capture、close。
- 播放栏右侧有桌面歌词开关；设置 → 歌词与动效的桌面歌词卡片按文字外观、歌词内容、底框与位置分组，可调宽度自适应、字号、字体颜色、文字不透明度、底框不透明度与毛玻璃/暗灰样式、单行/双行、逐字高亮、音译、翻译、文字发光和锁定，并即时预览字体与颜色。桌面、普通与 3D 歌词的字体选择集中到独立的歌词字体分组，西文和中文字体可分别指定，未指定的一项跟随对应界面字体；复用界面的西文优先、中文回退及系统兜底规则，已有单字体偏好保留为西文选项。双行显示当前句与下一句原文（最后一句无下一句时只显示当前句），翻译/音译仍由各自开关控制。双行的两句原文使用相同字号，底框高度共同分配给原文及辅助行。逐字高亮复用字词精确时序；只有开启桌面歌词且当前行有匹配的精确时间轴才每 50ms 同步真实播放时钟，悬浮窗最多外推 150ms，暂停/跳播/歌词偏移随时钟更新；无精确时序时按整句显示，切歌清除旧时序，关闭后清理同步与动画。文字透明度仅应用歌词内容，底框透明度独立；macOS 毛玻璃由 `lyrics-native-backdrop.ts` 使用公开 AppKit `NSVisualEffectView` 在底框区域提供桌面模糊，原生视图置于渲染内容下方并按圆角裁剪，不改变激活与输入行为；原生视图在关闭时释放，不可用时回退暗灰。Windows 10 1803 及以上由 windows-lyrics-backdrop.ts 使用原生 Acrylic 底框，独立 HWND 放在歌词窗口下方并按底框区域圆角裁剪，不增加渲染进程；底框不透明度控制整个毛玻璃底框的淡入淡出，染色深度固定，不影响歌词文字；layered/transparent 窗口保证鼠标穿透，按显示器 DPI 和页面缩放更新位置，随歌词隐藏、恢复和关闭管理生命周期，合成接口失败时回退暗灰色。Linux 禁用毛玻璃选项，暗灰只使用半透明底色。底框常态显示（锁定后也保留，0% 隐藏），编辑边框与控件仅未锁定悬停时显示。窗口默认宽 680，高度随字号与音译/翻译行数收紧（38px 单行时为 96），文字行与底框上下各留约 5px。底框高度决定字号，拉高同步放大、收矮同步缩小，仅改宽度不改变字号；设置页调整字号反向调整窗口高度。未锁定时鼠标移入显示编辑边框、右上角锁定/关闭按钮及左上角手柄，移出隐藏编辑控件并保留常态底框，底框可拖动；左上角手柄可拖动调整宽高，缩放时固定右下角。宽度自适应默认关闭；开启后按实际字体测量当前原文、下一句、音译及翻译中的最长一行，保持窗口中心和字号，仅宽度随内容变化；达到所在显示器工作区宽度时按省略号截断，关闭后恢复手动宽度。自定义宽度、位置与字号在当前会话保留；切歌及下一句、翻译、音译行出现或消失时保持字号，按内容调整高度，最小高度保障 12px 主歌词及完整辅助行；各行按 1.25 行高分配高度，给字体上下沿预留空间，音译和翻译字号为主歌词的 0.6 倍，行间隔为 4px。锁定时保留所选底框，隐藏编辑边框、调整手柄及锁定/关闭按钮，系统光标在歌词文字区域连续停留 0.5 秒后在文字上方 4px 处显示解锁图标；移向图标时保持显示，离开歌词与图标之间的区域后收起。歌词始终穿透，只有显示的图标接收点击，点击解锁后恢复拖动、关闭操作。仅锁定时检查系统光标，解锁/关闭后停止检查；解锁图标热区独立于 Windows 中键切换的歌词热区。窗口使用工作区内的紧凑高度，拖动跨屏时跟随光标所在显示器，位置仍限制在其工作区内。
- 音译按当前歌词行读取歌曲已有的音译数据，显示在原文与翻译之间；关闭开关或歌曲没有音译时不占空行。
- 没有当前歌词正文时（前奏、加载中或暂无歌词），双行模式第二行显示当前歌曲的歌手名；单行模式只保留第一行内容。歌词开始后第二行恢复下一句原文，歌曲没有歌手信息时不占空行。
- 双行歌词按顺序换句时使用约 320ms 的上滑滚动：当前句退出、下一句升为当前句、新下一句从下方进入。滚动仅作用于文字，不额外改变窗口高度、辅助行布局与解锁热区；内容行数变化仍按原规则调整窗口。切歌、跨句跳播、占位内容及单行模式即时更新，系统开启减少动态效果时关闭滚动，快速换句或卸载时取消旧动画。
- 桌面歌词使用不可聚焦窗口并以 `showInactive()` 显示；macOS 使用 `panel` 和 `acceptFirstMouse: true`，创建后由 `macos-lyrics-window.ts` 同步设置 AppKit `_setPreventsActivation:` 标记，处理 [macOS 27 中 panel 仍会激活应用的上游缺陷](https://github.com/electron/electron/issues/53889)。该方法属于私有接口，升级 macOS/Electron 时需实测拖动、缩放与锁定按钮；不支持时输出明确警告。Koffi 固定使用包含两种 Mac 架构预编译文件的 2.x，并显式解包原生文件。
- 开关与外观偏好单独保存在 `simplemusic-desktop-lyrics`，不影响场景参数；退出应用保留开启状态。拖动位置目前仅在当前会话保留。
- 只有用户主动缩放窗口后的实际字号经 `lyrics:size-changed` 回传设置并保存，回传不再发送字号请求，避免旧尺寸覆盖正在拖动的窗口。外观变化立即下发；歌词按当前曲目归属过滤，切歌时不会推送上一首文本。preload 缓存首屏完整快照，订阅时重放，防止页面加载先于 React 订阅时丢失状态。

## wallpaper(动态壁纸)

`overlays/wallpaper/index.tsx` + `wallpaper.html`。直接渲染 `src/components/Visualizer/Scene.tsx`。

- 壁纸窗口是独立渲染进程,自带一份 visual store;主窗口 `useWallpaperSync` 经 `wallpaper:update` 推送 FxParams,入口处 `useVisualStore.getState().updateFx()` 同步到本地 store。
- 注意:主窗口与壁纸各自可能跑全屏 WebGL,"同屏只跑一个"的约束指单个窗口内。

## mini-player(迷你悬浮播放条)

`overlays/mini-player/index.tsx` + `mini-player.html` + `mini-player.css`(重置层)。渲染 `src/components/Player/MiniPlayerBar.tsx`。

- 开关在**播放栏右侧**的 `MiniPlayerButton`(不在设置页);设置页只留外观项(不透明度/模糊/色调/进度条/歌词)。
- 开启后主窗口隐藏、迷你播放条显示；点击封面或关闭按钮会退出迷你模式并恢复主窗口，二者保持互斥。
- 进入迷你模式时迷你窗口承接键盘焦点，再按应用内「迷你 / 完整模式」快捷键可返回主窗口；自定义按键同步生效。与全局绑定同键且注册成功时由全局入口处理，避免双触发。焦点切换到其他应用后，需使用全局快捷键返回。
- 数据流:主窗口 `useMiniPlayerSync` 拆三条 effect 推送(曲目态、1Hz 进度、歌词行)→ `miniplayer:update`;回程控制走 `overlay:miniplayer-control` → 主进程转 `miniplayer:control` 事件 → `useDesktopBridge` 落到 player/playlist store。
- 尺寸:高度锁死(常态 80,音量弹层展开 136,底边不动);宽度由自绘右边缘手柄经 `overlay:miniplayer-resize-by` 改窗口,主进程再用 `miniplayer:width-changed` 回传主窗口持久化。宽度 ≥ `MINI_PLAYER_LYRICS_WIDTH` 时展开歌词行。
- 窗口 `resizable: false`,尺寸只由 `setBounds` 改(改尺寸前临时 `setResizable(true)`,否则 macOS 会忽略);放开 OS 边缘拖拽会与自绘手柄同帧各改一次宽度而抖动。
- 透明留白区在 OS 层面同样挡桌面点击(CSS `pointer-events: none` 不解决),所以弹层空间是按需长高而非常驻。
- 共享常量在 `src/lib/mini-player-config.ts`,单独成文件是为了让 overlay 入口不把 zustand store 链打进包里。
- 性能:主窗口隐藏时卸载可视层,迷你窗口保留 Chromium 后台节流；首次加载发送完整快照,后续仅转发值有变化的字段。进度展示时最高 1Hz、无补间动画,关闭时停止周期推送；紧凑宽度或歌词关闭时不因换行触发重渲染和 IPC 更新,退出后销毁独立窗口；系统关闭迷你条也会退出迷你模式并恢复主窗口，应用退出和退托盘保持各自行为。音量弹层展开后关闭重开仍保持底边；页面重载每次重放完整快照，包括曲目、外观和返回快捷键。
- 内存:迷你条新增独立渲染进程,主窗口仍承担音频播放,不是以小进程替换大进程。进程 RSS 含共享映射,不能把 RSS 求和当作应用独占物理内存；macOS 验收同时关注私有内存、回收后的 JS/Blink 堆和长期增量。

## 修改注意

- 新增悬浮窗需同时改:electron.vite.config.ts(renderer input)、overlay-manager(创建/定位)、preload/overlay.ts(桥)、`src/types/ipc.ts`(payload 类型)。
- overlay 入口不走 `index.html` 的主 App,不要在其中引入依赖主窗口全局 hooks 的组件。
