# SimpleMusic UI 重设计 — Design Doc

**日期：** 2026-06-28  
**状态：** 已确认，待实施  
**作者：** Yangshenghao

---

## 1. 背景与目标

原项目名 Mineradio 已废弃，品牌重命名为 **SimpleMusic**，版本从 `1.0.0` 重新开始。

当前 UI 问题：
- 顶部行有"歌单架""设置"等功能按钮堆叠，视觉粗糙
- 缺少探索/发现页，没有歌手详情页
- 仅有深色模式，缺少浅色模式及切换机制
- 各组件动效不统一

目标：用 **Apple Liquid Glass 风格（Arctic Frost 方案）** 全面重设计 UI，实现：
- 简约高级的视觉语言，配色统一协调
- 流畅的动效体系
- 探索页（首页）+ 歌手页（新增）
- 浅色 / 深色双模式
- 统一 MusicService 抽象层（支持未来多音源）

---

## 2. 应用信息

| 字段 | 值 |
|---|---|
| 应用名 | SimpleMusic |
| `package.json` `name` | `simplemusic` |
| `package.json` `productName` | `SimpleMusic` |
| `package.json` `version` | `1.0.0` |

---

## 3. 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│ ● ● ●  [🔍 pill]      探索  我的库  设置      [🎵 网易云] [头像] │  ← TitleBar
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    主内容区（随标签切换）                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [封面]  歌名 · 歌手      ⏮  ⏸  ⏭      🔊━━━   HD        │  ← PlayerBar（固定底部）
└─────────────────────────────────────────────────────────────┘
```

### 3.1 TitleBar 详细定位规则

- **左侧**（绝对定位）：traffic lights + 搜索胶囊按钮，搜索展开时向右生长
- **中间**（`position:absolute; left:50%; transform:translateX(-50%)`）：探索 / 我的库 / 设置，始终居中，不受左侧影响
- **右侧**（绝对定位）：音源徽标胶囊（点击切换） + 登录头像

### 3.2 搜索行为

- 默认状态：小胶囊图标按钮（`🔍`）
- 点击后：`width` 弹性展开为输入框（`300ms spring`），标签组位置不变
- 结果以浮层展示，点击歌曲 → 立即播放，点击歌手 → 进入歌手页
- 按 Esc 或点击外部 → 收起

---

## 4. 色彩系统

### 4.1 CSS Token

| Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--bg-base` | `#f5f7fa` | `#10141e` | 页面底色 |
| `--bg-elevated` | `rgba(255,255,255,0.72)` | `rgba(20,30,55,0.65)` | 毛玻璃面板 |
| `--bg-overlay` | `rgba(255,255,255,0.88)` | `rgba(15,22,42,0.80)` | 浮层（搜索/下拉） |
| `--accent` | `#4a90d9` | `#5da3f0` | 主强调色 |
| `--accent-warm` | `#ff9a3c` | `#ffad5c` | 次强调色（播放按钮等） |
| `--text-primary` | `#1a1f2e` | `#e8ecf5` | 主文字 |
| `--text-secondary` | `#6b7280` | `#8a95b0` | 次级文字 |
| `--border` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` | 描边/分割线 |
| `--blur` | `blur(32px)` | `blur(32px)` | 毛玻璃模糊量 |
| `--radius-card` | `16px` | — | 卡片圆角 |
| `--radius-pill` | `999px` | — | 胶囊/按钮圆角 |

### 4.2 深浅模式切换

- 默认跟随系统 `prefers-color-scheme`
- 设置页可手动锁定：自动 / 浅色 / 深色
- 切换时：`transition: background 350ms ease-in-out, color 200ms ease-in-out`
- Three.js 可视化背景：深色 `#080c14`，浅色 `#e8edf7`

---

## 5. 页面设计

### 5.1 探索页（首页）

从上到下：

**① Hero Banner**
- 全宽，高度约 `340px`
- 3–5 张轮播（推荐歌曲/歌单封面）
- 封面主色用 Canvas 提取后渐变染色背景，轮播切换时背景色平滑过渡 `800ms`
- 封面图 parallax：鼠标移动时位移 ±8px
- 内含：大封面图 + 歌名 + 歌手 + ▶ 立即播放

**② 今日推荐**（横向卡片轨道）
- 标题行右侧"查看全部 →"
- 支持鼠标滚轮横向滑动，两端渐隐蒙版
- 卡片：封面 + 歌名 + 歌手名

**③ 推荐歌单**（横向大卡片轨道）
- 卡片：封面 + 歌单名 + 曲目数

**④ 新歌速递**（列表行）
- 行格式：序号 + 封面 + 歌名 + 歌手 + 时长 + ▶

### 5.2 我的库

子标签：**歌单 / 收藏 / 最近播放**（胶囊样式）

- **歌单**：4 列网格，卡片含封面 + 歌单名 + 曲目数；点击进歌单详情
- **收藏**：歌曲列表行（同新歌速递格式）
- **最近播放**：时间轴列表，按 今天 / 昨天 / 更早 分组

**歌单详情**（子页面）：
- 顶部大封面 header + 染色背景
- 下方歌曲列表
- 左上角 `← 返回`，`slide-in-right` 进入动画

### 5.3 歌手页（新功能）

入口：搜索结果点击歌手 / PlayerBar 歌手名点击

- 顶部全宽歌手大图，动态染色背景
- 歌手头像 + 名字 + 粉丝数 / 单曲数 + ▶ 播放全部
- 子标签：**热门单曲 / 专辑 / 相似歌手**
- 热门单曲：列表行，序号 + 封面 + 歌名 + 时长 + ▶
- 专辑：横向卡片轨道

### 5.4 设置页

分组列表样式：

| 分组 | 内容 |
|---|---|
| 账户 | 头像 + 用户名 + 退出登录 |
| 外观 | 主题模式（自动/浅色/深色）+ 强调色预设 |
| 音乐 | 音源切换（网易云/QQ）+ 音质偏好（标准/高/无损）|
| 桌面歌词 | 开关 + 字体大小 |
| 关于 | SimpleMusic v1.0.0 |

---

## 6. MusicService 统一抽象层

### 6.1 接口定义

```typescript
interface MusicService {
  getRecommendBanners(): Promise<Banner[]>
  getRecommendPlaylists(): Promise<Playlist[]>
  getNewSongs(): Promise<Track[]>
  getPlaylistDetail(id: unknown): Promise<Track[]>
  searchTracks(keyword: string): Promise<Track[]>
  searchArtists(keyword: string): Promise<ArtistInfo[]>
  getArtistDetail(id: unknown): Promise<ArtistInfo>
  getArtistSongs(id: unknown): Promise<Track[]>
  getArtistAlbums(id: unknown): Promise<Playlist[]>
  getTrackUrl(track: Track): Promise<string>
  getLyrics(track: Track): Promise<LyricLine[]>
}
```

### 6.2 实现层

- `NeteaseMusicService` 实现 `MusicService`，调用 `/api/netease/…` 路由
- `QQMusicService` 实现 `MusicService`，调用 `/api/qq/…` 路由
- `useMusicService()` hook：读取 `settings.activeSource`，返回对应实例
- 切换逻辑：`settingsStore` 存 `activeSource: 'netease' | 'qq'`

### 6.3 Banner 新类型

```typescript
interface Banner {
  id: unknown
  title: string
  subtitle?: string
  cover: string
  track?: Track
  playlist?: Playlist
}
```

---

## 7. 动画系统

### 7.1 基础曲线 Token

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

GSAP `power2.out` 用于搜索框展开和 Hero 幕布。

### 7.2 场景规范

| 场景 | 动效 | 时长 |
|---|---|---|
| 标签页切换 | `opacity 0→1` + `translateY 12px→0` | `220ms ease-out` |
| 搜索框展开/收起 | width 弹性伸缩 + 浮层 slideDown | `300ms spring` |
| Hero Banner 轮播 | 背景色渐变 + 封面 crossfade | `800ms ease-in-out` |
| 卡片 hover | `translateY(-4px) scale(1.02)` + 阴影 | `200ms ease-out` |
| 页面滚动进入 | IntersectionObserver stagger `40ms` | `320ms ease-out` |
| 歌单/歌手详情进入 | `slide-in-right` | `250ms ease-out` |
| 搜索结果浮层 | `scale(0.96→1)` + `opacity 0→1` | `180ms ease-out` |
| 深浅模式切换 | 全局 background/color transition | `350ms ease-in-out` |
| PlayerBar 封面切换 | 旋转 + crossfade | `400ms ease-in-out` |

### 7.3 实现原则

- CSS transition 为主，零 JS 开销
- GSAP 仅用于搜索展开和 Hero 幕布两处（项目已引入 GSAP 3）
- `prefers-reduced-motion` 时所有动画 duration 归零

---

## 8. 移除内容

| 当前组件/元素 | 处理方式 |
|---|---|
| `ShelfScene`（3D 书架） | 移除，歌单改为网格卡片布局 |
| 顶部行"歌单架""设置"按钮 | 移除，统一收入标签导航 |
| `App.tsx` 的 `settingsOpen` / `lyricsOpen` state | 重构为路由/页面状态 |

---

## 9. 不在本次范围内

- 可视化粒子云 / Three.js FX 调参界面（保留现有实现，不动）
- 桌面歌词 overlay（保留现有实现）
- 快捷键设置（保留现有实现）
- QQ Music 服务端接口补全（预留接口，第二期实现）
