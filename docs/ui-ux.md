# 界面现状与维护地图

核对日期：2026-10-28。本文描述当前工作区源码，包含尚未发布的改动；`package.json` 当前版本为 `2.5.1`，任务队列开发记录归属 `dev/2.6.0`。版本号和截图不是最新改动已经发布或全部验收的证据。

设计前依次读 [产品理念](../PRODUCT.md) → [设计准则](../DESIGN.md) → 本文，再读受影响源码。技术装配详见 [渲染层](modules/renderer.md)，不要从旧截图或带日期的方案推断当前入口。

## 界面地图

主窗口由 [AppShell](../src/components/Layout/AppShell.tsx) 装配，顶栏与播放栏悬浮在内容之上；[navigation store](../src/stores/navigation.ts) 管理视图及前进、返回。下表用于定位职责，不要求所有页面套同一布局。

| 界面 | 用户任务与现有结构 | 实现入口 |
|---|---|---|
| 顶栏 | 导航、全局搜索、平台与账号、按需任务入口；窄窗口仍需保留搜索和窗口操作空间 | [TopBar](../src/components/Layout/TopBar.tsx) |
| 探索 | 浏览当前内容平台的推荐、榜单与个人栏目；保留封面堆叠与横排的内容表现 | [ExplorePage](../src/pages/ExplorePage.tsx) |
| 我的库 | 应用歌单、平台歌单、收藏、最近播放、离线、本地；应用歌单栏目内切换歌单与伴奏成品 | [LibraryPage](../src/pages/LibraryPage.tsx)、[LibraryTabs](../src/pages/LibraryTabs.tsx)、[CollectionKindSwitch](../src/pages/CollectionKindSwitch.tsx) |
| 本地音乐 | 文件夹索引、筛选与播放；移除文件夹明确原音乐文件保留 | `LibraryPage.tsx` 内的 `LocalMusicTab` |
| 离线音乐 | 浏览已保存音频，筛选、排序、播放与多选管理；与歌曲下载目录分开 | [OfflineMusicTab](../src/pages/OfflineMusicTab.tsx) |
| 伴奏成品 | 搜索、播放、辨别模型版本、定位文件及删除；齿轮进入相关设置，生成任务交给任务面板 | [AccompanimentsLibrary](../src/pages/AccompanimentsLibrary.tsx) |
| 搜索与音乐详情 | 跨来源搜索，按歌曲、歌手、专辑、歌单查看；详情播放、加入与批量管理 | [SearchPage](../src/pages/SearchPage.tsx)、[ArtistPage](../src/pages/ArtistPage.tsx)、[ArtistSongsPage](../src/pages/ArtistSongsPage.tsx)、[PlaylistDetailView](../src/components/Playlist/PlaylistDetailView.tsx)、[AppPlaylistPage](../src/pages/AppPlaylistPage.tsx)、[ToplistPage](../src/pages/ToplistPage.tsx)、[AppleChartPage](../src/pages/AppleChartPage.tsx) |
| 漫游与刷歌 | 从歌手关系与持续选曲发现音乐；保持清晰的开始动作和会话状态 | [RoamPage](../src/pages/RoamPage.tsx)、[ShuangePage](../src/pages/ShuangePage.tsx) |
| 播放栏与播放队列 | 播放、进度、音量、伴奏、歌词和接下来播放的歌曲；更多菜单承载相关播放设置 | [PlayerBar](../src/components/Player/PlayerBar.tsx)、[QueuePanel](../src/components/Player/QueuePanel.tsx)、[MoreMenu](../src/components/Player/MoreMenu.tsx) |
| 伴奏版本面板 | 选择模型与成品版本、发起生成；等待入队回执期间保持忙态，运行与失败任务转交专门队列 | [AccompanimentPanel](../src/components/Player/AccompanimentPanel.tsx) |
| 后台任务队列 | 头像旁按需出现入口，面板分下载与伴奏生成两区；入队不自动弹面板，两套后台调度保持独立 | [TaskBubble](../src/components/Layout/TaskBubble.tsx)、[TaskPanel](../src/components/Layout/TaskPanel.tsx)、[task-center](../src/stores/task-center.ts) |
| 歌词与音乐舞台 | 普通歌词和动态样式，封面、字体、氛围与演出按场景组织 | [LyricsPanel](../src/components/Lyrics/LyricsPanel.tsx)、[歌词样式目录](../src/lib/lyric-style-catalog.ts) |
| 设置与关于 | 音源与播放、界面与窗口、歌词与特效、缓存与下载、快捷键、关于；当前是单列分组的连续长页，目录定位，窄窗口改横向分类 | [SettingsPage](../src/pages/SettingsPage.tsx)、[ReleaseHistoryPage](../src/pages/ReleaseHistoryPage.tsx) |
| 独立桌面界面 | 桌面歌词、迷你播放条与壁纸；受平台和窗口能力限制，不能仅凭主窗口截图验收 | [悬浮窗说明](modules/overlays.md) |

“下载音乐页面”在讨论中可能指下载任务面板，也可能指离线音乐列表；动手前按实际入口区分，不另造一个同名页面。播放队列决定接下来听什么，后台任务队列管理下载和生成，两者不能混用。

当前动态歌词目录为跃字、云阶、拼版、凝彩、商籁、镜台、粒光；默认跃字。镜台与粒光是重型 WebGL 场景，预览与背景需遵守互斥和资源释放规则。已撤下的旧样式与旧总开关不能从历史设计稿恢复为现行功能；名称、可选项与迁移以样式目录为准。

## 共用组件与实现入口

| 模式 | 优先使用 | 现行范围与边界 |
|---|---|---|
| 库列表工具栏 | [LibraryToolbar](../src/components/ui/LibraryToolbar.tsx) | 伴奏、本地、离线；左侧主操作与数量，右侧搜索与辅助操作，窄窗口按组换行。搜索默认放大镜，聚焦或有内容时展开，空内容失焦收起；支持清除、Esc 清空收起与输入法期间的 Esc 避让 |
| 普通单选下拉 | [Select](../src/components/ui/Select.tsx) | 离线排序、伴奏版本、歌词测试曲与歌词来源管理；主题表面、选中勾选、禁用、开合动效、外部点击/Esc/父级滚动关闭；浮层使用 top layer 避让窗口及原生 dialog 裁剪。字体选择保留专用组件 |
| 普通操作与图标 | [ActionButton](../src/components/ui/ActionButton.tsx)、[ActionIcon](../src/components/ui/ActionIcon.tsx) | 当前库与任务等已接入区域；普通按钮 32px、紧凑 28px，保留主操作、危险、忙态和禁用语义。全应用尚未逐项迁移 |
| 悬停提示 | [HoverTips](../src/components/ui/HoverTips.tsx) | 单一提示层、窗口避让、长内容换行、快速重入及状态变化更新。新控件显式用 `data-tip`，避免同时触发原生 `title` |
| 平台详情内搜索 | [TrackSearch](../src/components/ui/TrackSearch.tsx) | 保留原有可展开行为；同为搜索并不意味着必须换成库工具栏 |
| 歌单与集合 | [LibraryShelf](../src/pages/LibraryShelf.tsx) | 复用库内集合展示，保留平台统计、账号与实际详情数量的不同口径 |
| 歌曲行与批量操作 | [TrackRow](../src/components/Explore/TrackRow.tsx)、[BatchTrackActions](../src/components/Playlist/BatchTrackActions.tsx)、[SelectionControls](../src/components/Playlist/SelectionControls.tsx) | 按页面能力复用；多选与队列、下载等动作保留来源和可播性规则 |
| 长列表与滚动 | [VirtualList](../src/components/ui/VirtualList.tsx)、[ScrollArea](../src/components/ui/ScrollArea.tsx)、[页面滚动样式](../src/styles/page-scroll.module.css) | 虚拟化与原生滚动条，遵守顶栏/播放栏安全区，不另造整套滚动条 |
| 设置控件 | [SettingSlider](../src/components/ui/SettingSlider.tsx)、[JellyRadio](../src/components/ui/JellyRadio.tsx)、[Switch](../src/components/ui/Switch.tsx)、[InfoButton](../src/components/ui/InfoButton.tsx) | 同类字段沿用组件与基线；帮助承载补充说明，不隐藏必需影响 |

这是复用入口，不是强制一次性迁移清单。没有相同任务和行为时不强行合并。新增共用模式时同时更新本表，避免以后再次各写一套。

## 动效与主题的现状

- 基础与玻璃表面使用 [tokens.css](../src/styles/tokens.css)，字体沿用用户设置。深浅主题、封面氛围与减少透明度都有现有路径，普通页面不另建配色体系。
- 强调色经 [theme-tone.ts](../src/lib/theme-tone.ts) 和 [useAccentTheme](../src/hooks/useAccentTheme.ts) 生成静止、悬停、按下色；近期修复了主按钮反馈降低文字对比的问题。色彩函数的测试不等于所有玻璃背景、文字和图标已经通过对比验收。
- [useMotion](../src/hooks/useMotion.ts) 读取独立开关：页面转场、平滑滚动、歌词换句，以及按压、悬停抬升、切换、指示器、滑杆、拖动、图标、弹层生长、队列动效。预设做批量设置，各开关不互相压制。
- [useSystemReducedMotion](../src/hooks/useSystemReducedMotion.ts) 当前用于任务入口、任务面板和共用提示；共用按钮、播放队列等局部 CSS 也有系统偏好分支。其他区域需逐处查实现，不能宣称全应用已统一响应系统减少动态。
- [motion-presets.ts](../src/lib/motion-presets.ts) 是动效参数入口。任务入口最新采用轻移与淡入、独立按压层和槽位过渡，旧截图中的液态连接颈部已经移除。
- 鼠标与快捷键策略见 [设计准则](../DESIGN.md#操作层级)；部分历史组件仍保留键盘行为，本文不将目标策略当作所有代码已一致的事实。

## 近期实现与验收边界

以下区分“源码已有”和“真实验证过”。详细结果保留在对应记录，不把某次测试数量变成长期门槛。

| 区域 | 当前已有 | 已有证据与剩余缺口 |
|---|---|---|
| 库列表与伴奏 | 共用工具栏、齿轮设置、搜索清除、长内容、行操作与错误恢复 | 早期有实际 Electron 列表/搜索/设置入口检查，以及深浅主题真实组件配临时数据的 `960×680` 对照；最新悬停、按压与动态提示尚缺实际鼠标与连续帧复验 |
| 任务入口与面板 | 下载/伴奏分区、定位、进度、完成反馈、已读驻留、重试/暂停与忙态 | 分阶段有 Electron 展示投影、真实组件鼠标及连续帧记录；旧截图保留历史形态。未覆盖真实网络下载、完整模型推理、Windows 与 `960×540` 全流程 |
| 强调色和异步状态 | 状态色计算、提示原地更新、生成入队去重与等待回执保护 | 类型检查、回归与独立复核有记录；最新视觉和真实端到端行为不能由这些测试代替 |
| 全应用其他页面 | 既有探索、搜索、详情、设置与歌词体系 | 2026-10-23 的审查仅是当时的问题线索，部分后续已改；本轮未重新完成全站视觉审查，不直接沿用旧问题的“未修复”结论 |

证据入口：[音乐库与任务操作统一](reviews/2026-10-28-library-controls.md)、[任务队列验收](reviews/2026-10-28-task-queue-verification.md)、[较早的界面审查](reviews/2026-10-23-ui-visual-audit.md)。最近库控件记录中的浏览器工具限制影响了当轮验收，不是产品自身限制，也不表示未来可省略验证。

## 下一次 UI/UX 工作的起点

1. 先完成最新库控件、提示与队列的真实鼠标复验，覆盖深浅主题、最小窗口 `960×540`、长内容、失败/忙态、快速重入及动效开关。保留明确的数据和截图来源。
2. 从地图查相邻界面与共用组件，检查同类问题：页头起线、搜索/主操作位置、按钮/提示、行操作、弹层、滚动和返回落位。旧审查只提供检查候选，是否仍存在需重新观察。
3. 跨页检查常驻文字按钮和重复说明，按设计准则区分直接删除、图标表达与按需展开；此项尚未完成全应用验收。校对设置的信息密度、当前值、分组与预览，再检查探索、搜索、详情和音乐舞台各自应有的节奏。保持音乐场景表现力，不为统一而重写全部页面。
4. 将新确认的取舍更新到产品和设计文档，实际状态与缺口更新到本文；阶段截图、复现步骤和测试结果写入对应验收记录。

完成标准见 [设计验收](../DESIGN.md#设计验收)。不要把“下一次”理解为当前用户需要重新催促，也不要在没有检查证据时把候选问题直接列为已确认缺陷。
