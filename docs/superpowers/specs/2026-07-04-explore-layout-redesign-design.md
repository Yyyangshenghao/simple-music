# 探索页布局改版设计（方案 A：英雄区左右分栏 + Stack 卡片堆）

日期：2026-07-04
状态：已与用户逐节确认

## 目标

重构探索页（ExplorePage）：去掉顶部滚动 Banner，让「每日推荐」「私人雷达」两张常驻卡与可拖拽的推荐歌单 Stack 卡片堆成为页面主体，并为「最近播放」预留占位区。用户通过拖拽甩卡的方式持续刷新推荐歌单（无限流）。

## 布局（已确认线框）

```
┌──────────────────────────────────────────────┐
│ ┌────────┐   ┌──────────────┐                │
│ │📅 每日  │   │              │  歌单名        │
│ │  推荐   │   │  🃏 Stack    │  + 简介        │
│ ├────────┤   │  240×240 堆  │ （随顶卡切换） │
│ │📡 私人  │   │              │                │
│ │  雷达   │   └──────────────┘                │
│ └────────┘                                   │
│ 最近播放（占位 rail：一排灰色空态小方卡）      │
└──────────────────────────────────────────────┘
```

- 所有歌单卡均为**近正方形**：左列常驻卡约 150×150，Stack 约 240×240，最近播放小卡约 92×92（实现时用相对单位自适应）。
- 移除 `HeroBanner` 组件及各 service 的 `getRecommendBanners()`；后端 banner 路由保留不动。
- 移除页面底部现有「今日推荐」歌曲列表区块，内容并入每日推荐卡。

## 组件（均在 `src/components/Explore/`）

| 组件 | 职责 |
|---|---|
| `DailyCard` | 每日推荐方卡：日历样式（大日期数字 + 第一首歌封面背景）。点击进入现有详情视图（伪歌单「每日推荐」，tracks = recommend_songs 20 首，复用 AnimatedTrackRow 详情模式） |
| `RadarCard` | 私人雷达方卡：点击进入详情视图，数据来自雷达歌单（每日 35 首） |
| `Stack` | React Bits Stack 移植为 TypeScript + **受控模式**：卡片数组由 ExplorePage 管理，只渲染顶部 5 张；甩卡回调里从池子补新卡。卡面 = 歌单封面 + 底部渐变遮罩上的歌单名 |
| `PlaylistPreviewModal` | 点击顶卡弹出的小卡弹窗：封面、歌单名、简介、可滚动歌曲列表（打开时才拉 getPlaylistDetail）、「播放全部」按钮；单曲可点播；Esc/遮罩/按钮关闭 |
| `RecentRail` | 最近播放占位：标题 + 一排灰色空态方卡，暂不接数据（后续用网易 `record_recent_song` 接入） |

## 数据流与后端改动

- **`/api/netease/recommend/playlists`**：`personalized` limit 8 → 30；去掉 `recommend_resource` 混入（新布局不再展示"私人推荐"歌单列表）。
- **Stack 无限流**：前端把 30 个作为池子，甩一张补一张；池子剩 ≤5 张时带新 timestamp 再拉一批，按 id 去重后追加；若新批全部重复，则回收已甩出的卡循环使用。补卡/去重/回收逻辑抽成纯函数 `src/lib/stack-pool.ts`。
- **新端点 `/api/netease/radar`**：`playlist_detail` + 固定歌单 id `3136952023`（社区通行做法，带登录 cookie 返回个人化每日 35 首）。**实现第一步先 curl 验证**；拿不到则雷达卡隐藏。
- **每日推荐**：复用现有 `/api/netease/recommend/songs`。
- **类型**：`Playlist` 加 `description?: string`；`mapDiscoverPlaylist` 带上 `copywriter`/`description` 供弹窗简介。
- **service 层**：`MusicService` 加可选方法 `getDailySongs?()`、`getRadarPlaylist?()`，仅网易实现；页面按方法是否存在决定渲染区块。

## 交互细节

- **拖拽甩卡**：沿用 React Bits 手势（motion 已在依赖），位移超阈值（sensitivity ≈ 170）甩出 → 池子补新卡；未超阈值弹回。`randomRotation` 开轻微值，堆叠错位角 4°。
- **点击 vs 拖拽**：按位移区分，tap 打开 `PlaylistPreviewModal`；不启用 `sendToBackOnClick`。
- **顶卡信息随动**：Stack 右侧信息块（歌单名 + 简介）随顶卡切换，淡入淡出（复用 `motion-presets`）。
- **动效可达性**：遵守 `prefers-reduced-motion`（参照 TiltCard 现有处理）；减动效时甩卡改为淡出淡入。

## 错误处理与降级

| 场景 | 行为 |
|---|---|
| 未登录网易 | 每日推荐/雷达接口返回空 → 对应卡不渲染；左列全空时 Stack 水平居中（纯 CSS 自适应） |
| QQ 音源 | 可选方法不存在 → 只渲染 Stack（池子换 `/api/qq/playlists/discover`），最近播放占位隐藏 |
| Stack 池子拉取失败 | Stack 区隐藏，显示轻量空态文案 |
| 补卡请求失败 | 静默保留现有卡循环，不打断拖拽 |
| 雷达歌单 id 验证失败 | 雷达卡隐藏，不阻塞其他区块 |

## 测试

- `stack-pool.ts` 纯函数配 vitest 单测（补卡、去重、循环回收）。
- 手测三种状态：网易已登录 / 未登录 / QQ 源，覆盖拖拽、弹窗、降级渲染。
- 全量跑现有 vitest + tsc + eslint 保证不回归。

## 明确不做（YAGNI）

- 最近播放的数据接入（仅占位，接口 `record_recent_song` 已确认存在）。
- 私人 FM 入口（与私人雷达是两个不同入口，本期不做）。
- QQ 源的每日推荐/雷达等价物。
- Stack 的 autoplay 自动轮播。
