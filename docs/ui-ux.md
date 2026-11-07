# 界面现状与维护地图

界面地图基线核对日期为 2026-10-28，平台内容入口于 2026-11-05 更新。本文包含尚未发布的改动；`package.json` 当前版本为 `2.6.2`，平台内容扩充归属 `dev/2.7.0`，旧任务队列记录归属 `dev/2.6.0`。版本号和截图不是最新改动已经发布或全部验收的证据。

设计前依次读 [产品理念](../PRODUCT.md) → [设计准则](../DESIGN.md) → 本文，再读受影响源码。技术装配详见 [渲染层](modules/renderer.md)，不要从旧截图或带日期的方案推断当前入口。

## 界面地图

主窗口由 [AppShell](../src/components/Layout/AppShell.tsx) 装配，顶栏与播放栏悬浮在内容之上；[navigation store](../src/stores/navigation.ts) 管理视图及前进、返回。下表用于定位职责，不要求所有页面套同一布局。

| 界面 | 用户任务与现有结构 | 实现入口 |
|---|---|---|
| 顶栏 | 导航、全局搜索、平台与账号、按需任务入口；窄窗口仍需保留搜索和窗口操作空间。Windows/Linux 是无边框窗口，右侧必须让出 `--sm-caption-reserve`（三个自绘窗口按钮），否则关闭按钮会压住头像 | [TopBar](../src/components/Layout/TopBar.tsx) |
| 探索 | 浏览平台推荐、榜单与个人栏目；网易/QQ/酷狗可进入完整推荐歌单，网易有本周常听，汽水有本机继续听和应用歌单，Apple 榜单可切换歌曲/专辑/歌单；保留封面堆叠与横排；现有栏目支持按音源独立开关和拖动排序（每日推荐、雷达与发现歌单仍合为“推荐与发现”，Apple 推荐与榜单精选为组合模块） | [ExplorePage](../src/pages/ExplorePage.tsx)、[完整歌单](../src/pages/ProviderPlaylistsPage.tsx)、[个人听歌栏目](../src/components/Explore/PersonalListeningSection.tsx)、[Apple 榜单](../src/pages/AppleChartPage.tsx) |
| 我的库 | 应用歌单、平台歌单、收藏、最近播放、离线、本地；应用歌单栏目内切换歌单与伴奏成品 | [LibraryPage](../src/pages/LibraryPage.tsx)、[LibraryTabs](../src/pages/LibraryTabs.tsx)、[CollectionKindSwitch](../src/pages/CollectionKindSwitch.tsx) |
| 本地音乐 | 文件夹索引、歌曲/专辑切换、组内筛选播放与批量整理；专辑返回恢复滚动；移除文件夹明确原音乐文件保留 | `LibraryPage.tsx` 内的 `LocalMusicTab` |
| 离线音乐 | 浏览播放器内已保存的离线音乐，筛选、排序、播放与多选管理，工具栏直达下载队列；与歌曲下载目录分开 | [OfflineMusicTab](../src/pages/OfflineMusicTab.tsx) |
| 伴奏成品 | 搜索、播放、辨别模型版本、定位文件及删除；齿轮进入相关设置，生成任务交给任务面板 | [AccompanimentsLibrary](../src/pages/AccompanimentsLibrary.tsx) |
| 搜索与音乐详情 | 跨来源搜索，按歌曲、歌手、专辑、歌单查看；BV/官方完整视频链接直接进入 B 站音频详情，短链接与指定非首 P 说明不支持；启用哔哩哔哩后可筛选该来源并点播音乐视频音频，结果优先显示识别出的歌名和歌手，视频原题作为辅助信息；详情播放、加入与批量管理 | [SearchPage](../src/pages/SearchPage.tsx)、[ArtistPage](../src/pages/ArtistPage.tsx)、[ArtistSongsPage](../src/pages/ArtistSongsPage.tsx)、[PlaylistDetailView](../src/components/Playlist/PlaylistDetailView.tsx)、[AppPlaylistPage](../src/pages/AppPlaylistPage.tsx)、[ToplistPage](../src/pages/ToplistPage.tsx)、[AppleChartPage](../src/pages/AppleChartPage.tsx) |
| 漫游与刷歌 | 从歌手关系与持续选曲发现音乐；保持清晰的开始动作和会话状态 | [RoamPage](../src/pages/RoamPage.tsx)、[ShuangePage](../src/pages/ShuangePage.tsx) |
| 播放栏与播放队列 | 播放、进度、音量、伴奏、歌词和接下来播放的歌曲；哔哩哔哩在播放页、应用歌单与最近播放优先显示歌名和歌手；更多菜单承载相关播放设置 | [PlayerBar](../src/components/Player/PlayerBar.tsx)、[QueuePanel](../src/components/Player/QueuePanel.tsx)、[MoreMenu](../src/components/Player/MoreMenu.tsx) |
| 伴奏版本面板 | 选择模型与成品版本、发起生成；等待入队回执期间保持忙态，运行与失败任务转交专门队列 | [AccompanimentPanel](../src/components/Player/AccompanimentPanel.tsx) |
| 后台任务队列 | 头像旁按需出现入口，面板分下载与伴奏生成两区；入队不自动弹面板，两套后台调度保持独立 | [TaskBubble](../src/components/Layout/TaskBubble.tsx)、[TaskPanel](../src/components/Layout/TaskPanel.tsx)、[task-center](../src/stores/task-center.ts) |
| 歌词与音乐舞台 | 普通歌词和动态样式，封面、字体、氛围与演出按场景组织 | [LyricsPanel](../src/components/Lyrics/LyricsPanel.tsx)、[歌词样式目录](../src/lib/lyric-style-catalog.ts) |
| 歌词来源 | 自动匹配之外，可输入歌名和歌手手动查找，预览后应用；可选中原题和预览文字复制；下次仍使用时记住此曲的搜索信息 | [LyricsSourceDialog](../src/components/Lyrics/LyricsSourceDialog.tsx) |
| 歌曲评论 | 网易/QQ 歌曲右键或播放栏更多菜单进入，只读热评与分页最新评论；标题与正文共用阅读列，返回保留歌曲列表上下文 | [SongCommentsPage](../src/pages/SongCommentsPage.tsx)、[TrackActionLayer](../src/components/Playlist/TrackActionLayer.tsx) |
| 设置与关于 | 音源与播放、界面与窗口、歌词与特效、缓存与下载、快捷键、关于；当前是单列分组的连续长页，目录定位，窄窗口改横向分类；已启用音源旁的齿轮向左展开大面积设置面板，包含探索模块、只读实时探索预览与平台专属选项，停用保留配置 | [SettingsPage](../src/pages/SettingsPage.tsx)、[ReleaseHistoryPage](../src/pages/ReleaseHistoryPage.tsx) |
| 独立桌面界面 | 桌面歌词、迷你播放条与壁纸；受平台和窗口能力限制，不能仅凭主窗口截图验收 | [悬浮窗说明](modules/overlays.md) |

页面统一称“离线音乐”，任务统一称“下载队列”，播放中临时存储称“自动缓存”；主动下载会先保留离线副本，再导出下载文件。播放队列决定接下来听什么，后台任务队列管理下载和生成，两者不能混用。

当前动态歌词目录为跃字、云阶、拼版、凝彩、商籁、镜台、粒光；默认跃字。镜台与粒光是重型 WebGL 场景，预览与背景需遵守互斥和资源释放规则。已撤下的旧样式与旧总开关不能从历史设计稿恢复为现行功能；名称、可选项与迁移以样式目录为准。

## 共用组件与实现入口

| 模式 | 优先使用 | 现行范围与边界 |
|---|---|---|
| 库列表工具栏 | [LibraryToolbar](../src/components/ui/LibraryToolbar.tsx) | 伴奏、本地、离线；左侧主操作与数量，右侧搜索与辅助操作，窄窗口按组换行。伴奏/离线目录按钮位于设置左侧，本地音乐逐曲定位原文件。搜索默认放大镜，聚焦或有内容时展开，空内容失焦收起；支持清除、Esc 清空收起与输入法期间的 Esc 避让 |
| 普通单选下拉 | [Select](../src/components/ui/Select.tsx) | 离线排序、伴奏版本、歌词测试曲与歌词来源管理；主题表面、选中勾选、禁用、开合动效、外部点击/Esc/父级滚动关闭；浮层使用 top layer 避让窗口及原生 dialog 裁剪。字体选择保留专用组件 |
| 普通操作与图标 | [ActionButton](../src/components/ui/ActionButton.tsx)、[ActionIcon](../src/components/ui/ActionIcon.tsx) | 当前库与任务等已接入区域；普通按钮 32px、紧凑 28px，保留主操作、危险、忙态和禁用语义。全应用尚未逐项迁移 |
| 悬停提示 | [HoverTips](../src/components/ui/HoverTips.tsx) | 单一提示层、窗口避让、长内容换行、快速重入及状态变化更新。新控件显式用 `data-tip`，避免同时触发原生 `title` |
| 平台详情内搜索 | [TrackSearch](../src/components/ui/TrackSearch.tsx) | 保留原有可展开行为；同为搜索并不意味着必须换成库工具栏 |
| 歌单与集合 | [LibraryShelf](../src/pages/LibraryShelf.tsx) | 复用库内集合展示，保留平台统计、账号与实际详情数量的不同口径 |
| 歌曲行与批量操作 | [TrackRow](../src/components/Explore/TrackRow.tsx)、[BatchTrackActions](../src/components/Playlist/BatchTrackActions.tsx)、[SelectionControls](../src/components/Playlist/SelectionControls.tsx) | 按页面能力复用；多选与队列、下载等动作保留来源和可播性规则 |
| 长列表与滚动 | [VirtualList](../src/components/ui/VirtualList.tsx)、[ScrollArea](../src/components/ui/ScrollArea.tsx)、[页面滚动样式](../src/styles/page-scroll.module.css) | 虚拟化与原生滚动条，遵守顶栏/播放栏安全区，不另造整套滚动条 |
| 音源设置 | [ProviderSettingsButton](../src/components/Settings/ProviderSettingsButton.tsx)、[ExploreModuleSettings](../src/components/Settings/ExploreModuleSettings.tsx) | 原生顶层面板向齿轮左侧覆盖；内部分区滚动，拖动接近边缘时自动滚动。音源未启用时禁用齿轮；模块开关与顺序按音源自动保存，右侧复用真实探索组件作只读缩略预览，账号会话变化时重建 |
| 设置控件 | [SettingSlider](../src/components/ui/SettingSlider.tsx)、[JellyRadio](../src/components/ui/JellyRadio.tsx)、[Switch](../src/components/ui/Switch.tsx)、[InfoButton](../src/components/ui/InfoButton.tsx) | 同类字段沿用组件与基线；帮助承载补充说明，不隐藏必需影响 |

这是复用入口，不是强制一次性迁移清单。没有相同任务和行为时不强行合并。新增共用模式时同时更新本表，避免以后再次各写一套。

## 动效与主题的现状

- 基础与玻璃表面使用 [tokens.css](../src/styles/tokens.css)，字体沿用用户设置。深浅主题、封面氛围与减少透明度都有现有路径，普通页面不另建配色体系。
- 强调色经 [theme-tone.ts](../src/lib/theme-tone.ts) 和 [useAccentTheme](../src/hooks/useAccentTheme.ts) 生成静止、悬停、按下色；近期修复了主按钮反馈降低文字对比的问题。色彩函数的测试不等于所有玻璃背景、文字和图标已经通过对比验收。
- [useMotion](../src/hooks/useMotion.ts) 读取独立开关：页面转场、平滑滚动、歌词换句，以及按压、悬停抬升、切换、指示器、滑杆、拖动、图标、弹层生长、队列动效。预设做批量设置，各开关不互相压制。
- [useSystemReducedMotion](../src/hooks/useSystemReducedMotion.ts) 当前用于任务入口、任务面板和共用提示；共用按钮、播放队列等局部 CSS 也有系统偏好分支。其他区域需逐处查实现，不能宣称全应用已统一响应系统减少动态。
- [motion-presets.ts](../src/lib/motion-presets.ts) 是动效参数入口。任务入口最新采用轻移与淡入、独立按压层和槽位过渡，旧截图中的液态连接颈部已经移除。
- 鼠标与快捷键策略见 [设计准则](../DESIGN.md#操作层级)；部分历史组件仍保留键盘行为，本文不将目标策略当作所有代码已一致的事实。

Windows 便携版在更新横幅和设置中使用既有手动下载分支，主进程阻止安装版更新。安装路径及文件事务已经补充自动检查，真实 Windows 安装器交互、全用户安装与异常恢复仍须按构建文档验收，不能以 NSIS 编译通过代替。

Windows 安装器源码已改用标准流程「选择安装范围 → 选择安装位置 → 安装进度 → 完成」。范围、目录、进度和完成均使用 NSIS 原生页面，不再绘制自定义目录页和品牌侧栏；安装与卸载保留应用图标，恢复默认字体、配色和按钮。路径校验和目录冲突避让仍生效，若改变最终位置则回到原生目录页要求再次确认。卸载恢复原生欢迎页及范围选择，保留文件与数据边界说明；不在选择卸载范围前确认某个目录。

此前自定义横幅、侧栏位图及其生成脚本已移除，避免 electron-builder 隐式加载旧素材。逐文件卸载与安装事务保护保留。新原生页面的路径调整确认、范围往返、UAC、升级和卸载仍待 Windows 实机验收；详见 [标准安装器研究与改动](reviews/2026-11-07-standard-windows-installer.md)。

应用内更新按当前版本自动选择通道：正式版只检查正式版，beta/rc 检查更高预发版及正式版；提示、下载任务和安装交接保留完整版本后缀，不增加通道开关。通道及缓存清理回归已通过，Windows 跨版本真实界面流程由维护者使用 [本地测试套件](../scripts/release/windows-update-test/README.md) 验收。

## 近期实现与验收边界

网易云音质档位改为打开播放栏「更多」面板时按需查询，QQ 保留延迟预取；请求次数已有回归测试，并完成真实组件的浏览器模拟验收（切歌不预探测、打开菜单显示加载与档位、重开复用缓存）；Electron 真机与真实账号仍待复验。

音源探索模块与只读实时预览已覆盖网易云、QQ、Apple、酷狗和汽水。QQ/Apple/酷狗/汽水于 2026-11-06 完成深浅主题及两种窗口尺寸的 16 场景模拟验收，包括开关、拖动和停用入口；真实账号内容与其他操作系统仍待验。详见 [验收记录](reviews/2026-11-05-explore-modules.md#实际界面与交互)。哔哩哔哩尚无探索页栏目，保留封面专属设置。

以下区分“源码已有”和“真实验证过”。详细结果保留在对应记录，不把某次测试数量变成长期门槛。

| 区域 | 当前已有 | 已有证据与剩余缺口 |
|---|---|---|
| 库列表与伴奏 | 共用工具栏、齿轮设置、搜索清除、长内容、行操作与错误恢复 | 早期有实际 Electron 列表/搜索/设置入口检查，以及深浅主题真实组件配临时数据的 `960×680` 对照；最新悬停、按压与动态提示尚缺实际鼠标与连续帧复验 |
| 任务入口与面板 | 下载/伴奏分区、离线音乐/伴奏库入口、定位、进度、完成反馈、已读驻留、重试/暂停与忙态 | 分阶段有 Electron 展示投影、真实组件鼠标及连续帧记录；旧截图保留历史形态。未覆盖真实网络下载、完整模型推理、Windows 与 `960×540` 全流程 |
| 强调色和异步状态 | 状态色计算、提示原地更新、生成入队去重与等待回执保护 | 类型检查、回归与独立复核有记录；最新视觉和真实端到端行为不能由这些测试代替 |
| 设置 · 网络与代理 | 模式/地址/Apple 出口常驻（非当前模式只禁用不消失），跟随系统时地址框显示系统当前代理；自动检测本机代理；检测结果分主次：需要处理的“问题”用卡片置顶并带解决按钮（让 Apple 直连→规则弹窗、Apple 改为直连、自动检测代理），结果四行（线路与出口只写一次，其后网易/QQ/Apple），“提示”一行小字垫底；超过 3 秒标黄“很慢”，直连被 TUN 接管时线路标注，Apple 行显示 Apple 判定地区；标题栏“代理软件规则”弹窗给出 Clash/Mihomo、Surge、sing-box 的 Apple 域名直连（推荐）与按进程整个应用直连规则，可一键复制；状态行一句概括，改设置后旧结果变淡保留；保存后自动检测；未改动时保存不用主按钮样式 | 2026-11-01 Electron 隔离 profile 实测：切换六种模式、检测前后、保存后面板上缘与高度不变；深浅主题、`960×540` 无横向溢出；本地 HTTP（带认证）与 SOCKS5 代理下网易 NCM、QQ、Apple、出口请求均经代理（443）。未覆盖 Windows、PAC 自动配置与需认证的系统代理 |
| 全应用其他页面 | 既有探索、搜索、详情、设置与歌词体系 | 2026-10-23 的审查仅是当时的问题线索，部分后续已改；本轮未重新完成全站视觉审查，不直接沿用旧问题的“未修复”结论 |

证据入口：[音乐库与任务操作统一](reviews/2026-10-28-library-controls.md)、[任务队列验收](reviews/2026-10-28-task-queue-verification.md)、[较早的界面审查](reviews/2026-10-23-ui-visual-audit.md)。最近库控件记录中的浏览器工具限制影响了当轮验收，不是产品自身限制，也不表示未来可省略验证。

## 下一次 UI/UX 工作的起点

1. 先完成最新库控件、提示与队列的真实鼠标复验，覆盖深浅主题、最小窗口 `960×540`、长内容、失败/忙态、快速重入及动效开关。保留明确的数据和截图来源。
2. 从地图查相邻界面与共用组件，检查同类问题：页头起线、搜索/主操作位置、按钮/提示、行操作、弹层、滚动和返回落位。旧审查只提供检查候选，是否仍存在需重新观察。
3. 跨页检查常驻文字按钮和重复说明，按设计准则区分直接删除、图标表达与按需展开；此项尚未完成全应用验收。校对设置的信息密度、当前值、分组与预览，再检查探索、搜索、详情和音乐舞台各自应有的节奏。保持音乐场景表现力，不为统一而重写全部页面。
4. 将新确认的取舍更新到产品和设计文档，实际状态与缺口更新到本文；阶段截图、复现步骤和测试结果写入对应验收记录。

完成标准见 [设计验收](../DESIGN.md#设计验收)。不要把“下一次”理解为当前用户需要重新催促，也不要在没有检查证据时把候选问题直接列为已确认缺陷。

### B 站歌曲身份识别

当前播放项在后台识别其他平台的歌曲身份，列表只复用已有聚合搜索结果和缓存，不逐项联网补专辑封面。规范歌名、歌手、封面及歌词复用已确认的歌曲引用，音频仍来自原 BV。标题读法歧义、时长或录音版本冲突时保留视频信息；身份变化同步播放栏、歌词页、迷你条与系统媒体信息。关闭“显示专辑封面”只影响封面，不关闭歌曲识别。算法与请求边界见[播放系统](playback-system.md#b-站统一歌曲身份识别)。本次自动回归覆盖识别、取消与同步；已用公开视频 BV1GJ411x7h7 实测规范歌名、歌手、专辑封面和歌词展示。总体匹配率、更多版本及各平台真实歌词时间轴仍需抽样实测，见[验证记录](reviews/2026-11-06-bilibili-song-identity.md)。
