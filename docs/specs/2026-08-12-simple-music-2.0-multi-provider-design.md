# Simple Music 2.0 多平台融合架构设计

> 状态：2.0 设计已确认，阶段 C 实现完成（B.1 真实窗口与 C 双账号播放矩阵待验收）
>
> 目标版本：`2.0.0`
>
> 日期：2026-08-12（2026-08-13 更新探索页平台切换决策）
>
> 关联问题：[#2 QQ 歌词错配](https://github.com/Yyyangshenghao/simple-music/issues/2)、[#3 QQ 音质与失败恢复](https://github.com/Yyyangshenghao/simple-music/issues/3)

## 1. 摘要

Simple Music 2.0 将从“同一时刻切换一个音乐平台使用”升级为“同时启用多个音乐平台的融合播放器”。网易云音乐、QQ 音乐以及未来接入的其他音源不再互斥：应用同时读取各平台的推荐、歌单、收藏和账号能力，并在播放时按照用户配置的音源优先级解析同一首歌，失败后依次降级到其他已启用音源。

2.0 不抹平平台差异，也不把不同平台数据伪装成完全等价的功能。每个歌单、曲目、推荐栏目和账号操作都保留明确的平台归属；播放器另外展示真正提供音频的音源。应用统一的是交互入口、领域协议和降级流程，而不是上游产品语义。

本次属于产品定位与核心架构变更，采用渐进迁移：先建立多音源运行时和来源模型，再改造内容聚合页面，最后替换播放解析链路。1.x 在此期间仍可维护和发布，不在设计阶段提前修改包版本。

## 2. 背景与问题

### 2.1 当前产品模型

当前应用以 `settings.activeSource` 为全局开关：

- `useMusicService()` 只返回网易云或 QQ 中的一个服务。
- 探索页、榜单、我的库、漫游和刷歌都围绕当前音源加载。
- 登录状态分别保存，但产品入口仍表现为“选择当前音源”。
- 播放器先使用曲目原音源；失败后只尝试固定的“另一个音源”。
- 推荐能力通过同名方法强行对齐，例如把网易云“每日推荐”和 QQ“猜你喜欢电台”都映射为 `getDailySongs()`。

这一模型在两个音源、功能以网易云为基准时尚可运行，但加入更多平台后会产生以下问题：

1. 新增音源需要修改设置、顶部栏、搜索、首页、播放器、回退规则和多个联合类型。
2. 平台原生能力被迫映射到网易云语义，容易出现名字相同、行为不同的假对齐。
3. 单一 `activeSource` 阻止用户同时看到多个账号中的推荐和歌单。
4. 当前只有“曲目来源”和一个临时 `fallbackSource`，不足以表达内容归属、实际音频来源和账号操作目标。
5. 二元的“对侧音源”无法扩展为三种及以上音源的有序降级。

### 2.2 已有可复用基础

2.0 不是从零重写，以下设计继续保留：

- `Track`、`Playlist`、`ArtistInfo` 已携带 `source`。
- `serviceFor(data.source)` 已用于歌单详情、歌手详情和懒加载等跨源安全场景。
- 缓存键大量采用 `source:id`，已具备复合身份基础。
- 网易云与 QQ 的登录窗口、服务端路由和客户端适配器彼此隔离。
- 播放器已有跨源同曲搜索、来源徽标、会话取消、音频代理和磁盘缓存。
- 页面异步请求普遍具备会话序号守卫，可扩展到多平台并发加载。

## 3. 产品目标

### 3.1 目标

1. 用户可以独立启用或停用每个音乐平台，同时保持多个平台登录。
2. 探索页可在所有已启用平台间快速切换，保留各平台原生推荐语义并明确标注来源。
3. 搜索、我的库、歌单、榜单和漫游可以容纳多个平台的数据。
4. 用户可以配置全局播放音源优先级，并可对当前歌曲临时指定音源。
5. 播放解析能在同一音源内降音质、切换地址，再按优先级尝试其他音源。
6. 每个内容实体和账号写操作都能明确定位到正确平台，避免跨平台误写。
7. 接入新音源时，以新增适配器和注册配置为主，页面不再增加大面积平台条件分支。
8. 单个平台超时、未登录或接口失效时，其余平台仍能正常展示和播放。

### 3.2 非目标

2.0 首版明确不承诺：

- 建立跨平台权威的“全局歌曲 ID”。
- 自动合并搜索结果中的所有同名歌曲。
- 跨平台同步红心、播放历史或关注歌手。
- 无确认地把一个平台的歌单写入另一个平台。
- 保证各平台拥有一一对应的推荐栏目。
- 把非官方上游接口包装成稳定 OpenAPI。
- 在 2.0 首版提供第三个线上音源；架构应能接入，但先用网易云和 QQ 验证。

## 4. 核心产品决策

### 4.1 “音源启用”取代“音源切换”

设置模型从：

```ts
activeSource: 'netease' | 'qq'
```

迁移为：

```ts
interface ProviderPreference {
  enabled: boolean
}

/** provider store 持久化切片；运行时只由 ProviderStore 持有和修改。 */
interface ProviderSettings {
  providers: Record<ProviderId, ProviderPreference>
  playbackOrder: ProviderId[]
  preferOriginSource: boolean
  multiSourceFallback: boolean
}
```

- `enabled` 决定该平台是否参与内容请求、搜索和播放候选。
- 登录状态与启用状态是双门槛：只有“已登录且已启用”的平台才参与应用内容；未登录平台只保留账号管理入口。
- `playbackOrder` 是播放优先级的唯一事实来源，必须恰好包含全部已登录且已启用的在线音源且不得重复。
- `preferOriginSource` 默认开启，优先保证准确、低延迟；用户关闭后严格按自定义顺序尝试。
- `multiSourceFallback` 决定首个音源失败后是否继续尝试后续音源；关闭时仍允许首个音源内部降音质和切换地址。
- 本地音乐不作为网络降级候选，但本地曲目本身始终可播放。
- `ProviderStore` 是这些字段的唯一运行时所有者；现有 settings store 只在迁移期读取旧值，不能保留第二份可写副本。

### 4.2 保留平台原生栏目，不做伪等价

网易云“每日推荐”、QQ“猜你喜欢”、各平台雷达和推荐歌单流都作为独立推荐栏目存在。统一层只描述它们的内容形态和展示要求，不把名称与刷新语义改成同一个概念。

### 4.3 区分三类来源

| 概念 | 含义 | 示例 |
|---|---|---|
| 内容来源 | 用户看到的曲目/歌单来自哪个平台 | QQ 歌单中的一首歌 |
| 实际播放来源 | 最终提供音频流的平台 | 优先级规则命中网易云 |
| 操作目标 | 红心、收藏、写歌单、听歌记录作用于哪个平台 | 红心默认写回 QQ，听歌记录写给实际播放的网易云曲目 |

来源差异必须进入领域状态，不能只靠临时 toast 表达。

### 4.4 不急于建立全局歌曲实体

平台曲目仍以 `(source, id)` 为身份。跨源匹配只产生“这次播放可使用的候选关系”，不永久宣称两个条目是同一个全局实体。

原因包括：现场版、伴奏、翻唱、重制版、同名歌曲和平台元数据差异都会造成误合并。2.0 首版宁可少换源，也不能静默播放错误歌曲。

## 5. 术语与身份模型

```ts
const PROVIDER_IDS = ['netease', 'qq'] as const
type ProviderId = (typeof PROVIDER_IDS)[number]
type MusicSource = ProviderId | 'local'

interface EntityRef {
  source: MusicSource
  id: string
}

interface PlaybackContext {
  type: 'playlist' | 'album' | 'search' | 'artist' | 'recommendation' | 'roam' | 'local'
  source?: MusicSource
  id?: string
}

type OperationKind = 'like' | 'unlike' | 'add-to-playlist' | 'remove-from-playlist' | 'scrobble'

interface OperationTarget {
  source: ProviderId
  track: EntityRef
  context?: EntityRef
  selectedBy: 'content-origin' | 'actual-playback' | 'user'
}

interface TrackOperation {
  kind: OperationKind
  target: OperationTarget
}
```

设计约定：

- `Track.source`、`Playlist.source` 表示内容来源，语义固定。
- `Track.provider` 与 `source` 当前重复，2.0 迁移期间标为废弃；全部调用点迁移后删除。
- 比较、缓存和持久化一律使用 `source:id`，禁止只比较 `id`。
- 队列上下文从裸 `contextId` 升级为 `PlaybackContext`，避免混合队列的歌单 ID 被错误上报到另一个平台。
- 跨源候选必须保留目标平台上的真实 `Track`，不能只保存目标 `source`。
- 所有账号写操作必须先构造 `TrackOperation`，provider 适配器校验 `target.source === target.track.source === 自身 id` 后才发送请求；组件不得从当前页面或实际播放来源自行猜测目标。
- 红心和歌单操作的默认目标来自内容来源；听歌记录的默认目标来自实际播放曲目。用户明确改选平台时使用 `selectedBy: 'user'`。
- `ProviderId` 由构建期注册表集中导出；新增平台只扩展注册表声明，不在业务组件里扩展平台联合类型。

## 6. 目标架构

```text
┌────────────────────────────── UI ──────────────────────────────┐
│ 探索平台视图 │ 全源搜索 │ 我的库 │ 漫游 │ 播放器来源选择        │
└───────────────┬───────────────────────┬─────────────────────────┘
                │                       │
       ┌────────▼────────┐     ┌────────▼──────────┐
       │ ContentHub      │     │ PlaybackResolver │
       │ 聚合/隔离/排序   │     │ 候选/音质/重试/降级 │
       └────────┬────────┘     └────────┬──────────┘
                │                       │
       ┌────────▼───────────────────────▼──────────┐
       │ Provider Registry + Runtime State         │
       │ enabled / auth / capabilities / playbackOrder │
       └───────┬───────────────────────┬───────────┘
               │                       │
       ┌───────▼────────┐      ┌───────▼────────┐
       │ NeteaseProvider│      │ QQMusicProvider│   ...
       └───────┬────────┘      └───────┬────────┘
               │                       │
       /api/netease/*            /api/qq/*
```

### 6.1 音源注册表

注册表替代散落的 `if (source === 'qq')`：

```ts
interface MusicProvider {
  descriptor: ProviderDescriptor
  catalog: CatalogCapability
  playback: PlaybackCapability
  account?: AccountCapability
  recommendations?: RecommendationCapability
  library?: LibraryCapability
  playlistWriter?: PlaylistWriterCapability
  history?: HistoryCapability
}

interface ProviderDescriptor {
  id: ProviderId
  label: string
  color: string
  iconKey: string
  defaultEnabled: boolean
}
```

规则：

- 在线音源必须实现 `catalog` 和 `playback`。
- UI 通过子能力对象是否存在判断支持情况，不再检查巨型接口上的多个可选方法。
- 品牌、登录入口、能力和服务实例在同一注册点声明。
- 服务端仍保留平台专属路由。2.0 不为了表面统一而重写稳定的 `/api/netease/*` 和 `/api/qq/*`。
- 新增音源的架构验收标准是：注册一个测试适配器后，探索页、搜索和播放候选无需新增平台专属 JSX 分支。

### 6.2 基础能力拆分

`MusicService` 拆成按职责组合的协议：

```ts
interface CatalogCapability {
  searchTracks(keyword: string, signal?: AbortSignal): Promise<Track[]>
  searchArtists(keyword: string, signal?: AbortSignal): Promise<ArtistInfo[]>
  getPlaylist(id: unknown, signal?: AbortSignal): Promise<PlaylistSkeleton>
  getTracksByIds(ids: unknown[], signal?: AbortSignal): Promise<Track[]>
  getArtistDetail(id: unknown, signal?: AbortSignal): Promise<ArtistInfo>
  getArtistSongs(id: unknown, signal?: AbortSignal): Promise<Track[]>
  getArtistAlbums(id: unknown, signal?: AbortSignal): Promise<Playlist[]>
}

interface PlaybackCapability {
  getQualities(track: Track, signal?: AbortSignal): Promise<QualityOption[]>
  resolve(track: Track, quality: AudioQuality, signal?: AbortSignal): Promise<PlaybackCandidate[]>
  getLyrics(track: Track, signal?: AbortSignal): Promise<LyricLine[]>
}

interface QualityOption {
  id: string
  label: string
  rank: number
}

interface PlaybackCandidate {
  source: ProviderId
  track: Track
  quality: QualityOption
  url: string
  trial: boolean
  expiresAt?: number
}

interface AccountCapability {
  getStatus(signal?: AbortSignal): Promise<AccountStatus>
  login(): Promise<AccountStatus>
  logout(): Promise<void>
}

interface LibraryCapability {
  getUserPlaylists(signal?: AbortSignal): Promise<Playlist[]>
  getLikedPlaylist?(signal?: AbortSignal): Promise<Playlist | null>
  likeTrack?(target: OperationTarget, like: boolean, signal?: AbortSignal): Promise<boolean>
}

interface PlaylistWriterCapability {
  createPlaylist(name: string, opts: { private: boolean }, signal?: AbortSignal): Promise<EntityRef>
  replaceTracks(playlist: EntityRef, tracks: EntityRef[], signal?: AbortSignal): Promise<void>
  updateDescription?(playlist: EntityRef, description: string, signal?: AbortSignal): Promise<void>
}
```

其中 `PlaylistSkeleton` 沿用当前定义：有序 `trackIds` 加已加载的 `tracks`；`AccountStatus` 至少包含认证状态和可选账号资料。阶段 A 的能力矩阵需要冻结每个可选接口的登录要求和空结果语义。

拆分后的好处：

- 漫游依赖目录和歌手能力，不必同时依赖账号歌单写入。
- 播放解析器只依赖 `playback`，不会知道首页推荐接口。
- 页面可以精确判断能力缺失，而不是用平台名称猜测。
- 接口测试可按能力建立契约套件，对所有音源复用。

## 7. 音源运行时状态

```ts
interface ProviderRuntimeState {
  enabled: boolean
  auth: 'unknown' | 'anonymous' | 'authenticated' | 'expired'
  profile?: {
    nickname: string
    avatar: string
  }
  lastError?: ProviderError
}

interface ProviderStore {
  byId: Record<ProviderId, ProviderRuntimeState>
  playbackOrder: ProviderId[]
  preferOriginSource: boolean
  multiSourceFallback: boolean
  setEnabled(id: ProviderId, enabled: boolean): void
  setPlaybackOrder(order: ProviderId[]): void
  setPreferOriginSource(enabled: boolean): void
  setMultiSourceFallback(enabled: boolean): void
  syncAccounts(): Promise<void>
}
```

约束：

- 平台必须先登录才能启用；登录成功后仍需用户明确启用，退出登录会自动停用。
- 关闭音源立即取消该音源的内容请求；当前正在播放的流不强制中断，下一次解析不再使用它。
- 播放优先级只允许包含已启用的在线音源，顺序变更对下一次加载生效。
- 登录失效立即停止该平台全部内容、写入与播放候选能力，不影响其他音源。
- 设置归档需要带 schema 版本，保证 1.x 的 `activeSource` 可迁移。

### 7.1 1.x 设置迁移

首次读取旧设置时：

1. 只迁移原 `activeSource` 为启用，另一平台需登录后由用户明确启用。
2. 原 `activeSource` 单独写入 `playbackOrder`。
3. 原 `crossSourceFallback` 原值写入 `multiSourceFallback`；关闭时只尝试根据“手动软优先 → 原源优先策略 → playbackOrder”算出的首个音源，仍保留该音源内部音质和地址降级。
4. 登录态仍由 Electron 登录分区和 server cookie 同步，不从旧 localStorage 猜测。
5. 写入新 schema 成功后不再写 `activeSource`，但至少一个 2.0 预发布周期保留只读兼容。

## 8. 推荐内容协议与探索页

### 8.1 推荐栏目模型

平台返回可渲染的栏目描述，不直接注入 React 组件：

```ts
type RecommendationKind =
  | 'daily-tracks'
  | 'radio'
  | 'radar'
  | 'playlist-feed'
  | 'toplist'
  | 'recent'

interface RecommendationSurface {
  id: string
  source: ProviderId
  kind: RecommendationKind
  title: string
  subtitle?: string
  presentation: 'hero' | 'rail' | 'stack' | 'grid'
  refresh: 'session' | 'daily' | 'paged' | 'stream'
  auth: 'none' | 'optional' | 'required'
}

interface RecommendationCapability {
  listSurfaces(): RecommendationSurface[]
  load(surfaceId: string, cursor?: string, signal?: AbortSignal): Promise<RecommendationPage>
}

interface RecommendationPage {
  items: Array<Track | Playlist>
  nextCursor?: string
  hasMore: boolean
}
```

示例：

| 平台 | 原生能力 | `kind` | 刷新语义 |
|---|---|---|---|
| 网易云 | 每日推荐 | `daily-tracks` | 每日快照 |
| 网易云 | 私人雷达 | `radar` | 平台歌单/每日内容 |
| QQ 音乐 | 猜你喜欢 | `radio` | 可继续取曲的电台流 |
| QQ 音乐 | 私人雷达 | `radar` | 分页取推荐曲目 |
| 两者 | 推荐歌单 | `playlist-feed` | 独立分页 |

### 8.2 全局内容平台与探索页信息架构

探索页和我的库在同一时刻只浏览一个平台，不再提供跨平台内容混排或“全部平台”视图。这个边界避免新增平台时继续扩展“如何交错栏目、如何比较推荐顺序、如何对齐平台能力”等页面级规则；多平台融合继续体现在统一入口、全局无缝切换、全源搜索、漫游和播放降级，而不是把平台内容强行拼在一个页面。

1. **问候与状态**：显示已启用平台数量；某平台账号失效时提供非阻塞提示。
2. **平台视图**：当前平台保留自己的推荐、账号歌单、最近内容和榜单语义，不与其他平台比较推荐分数或强行对齐栏目。
3. **全局侧边 Dock**：两个及以上平台参与时，在探索页与我的库右侧共用一个半隐藏切换器；单平台用户不显示该控件。
4. **能力驱动栏目**：只渲染当前平台声明的推荐能力，不展示空壳占位，也不以网易云栏目作为其他平台的模板。

侧边平台 Dock 参考 BewlyBewly 的侧边 Dock 与 half-hide 思路，但只借鉴信息层级和展开方式，不照搬视觉：

- 收起时只露出当前平台的紧凑标记，悬停、键盘聚焦或点击后展开平台名称列表。
- Dock 固定在内容区右侧并避开页面滚动条，不挤压推荐内容；展开层覆盖在内容上方。
- 不使用滚轮切换，避免用户滚动探索页时误触；点击平台后沿用现有纵向内容转场。
- 焦点停留在 Dock 内时不得自动收起；`Escape` 可关闭，所有入口都有文字名称和可访问标签。
- 平台列表来自 provider 注册表，只包含“已登录且已启用”的平台，不写死网易云与 QQ 分支。
- 记住全局内容平台；若该平台退出登录或被停用，自动切换到下一个参与平台。只剩一个平台时 Dock 消失。
- 启动时短暂等待上次选择的平台完成登录态核实；状态请求持续失败时不得永久阻塞，超过宽限时间后回退到已经可用的平台。
- 切换后探索页与我的库同时使用新平台；不改变平台启用状态、全源搜索参与范围或播放优先级。
- 不提供“全部平台”选项。Dock 是浏览上下文选择，不是平台启用开关，也不是播放来源选择器。
- 窄窗口不依赖悬停：点击当前平台标记打开紧凑浮层，选择后关闭。

探索页加载规则：

- 首屏只请求当前平台的 hero 和少量歌单；下方栏目进入视口后再加载，不在后台预取其他平台整页推荐。
- 每个平台的缓存和分页游标独立，切换回来允许复用短时缓存，但不能复用另一个平台的数据。
- 切换平台时创建新的页面会话；旧平台的在途响应不得写入当前视图。
- 当前平台失败时在其栏目内显示重试，侧边 Dock 仍可使用，用户可以切换到其他参与平台。
- 切换全局内容平台只改变探索和我的库的浏览内容，不改变音源启用状态、搜索范围或播放优先级。
- 所有响应落地前校验页面会话，以及目标平台是否仍处于“已登录且已启用”状态。

### 8.3 来源标识规范

来源信息必须可追溯，但允许用户控制视觉密度。设置提供“常显 / 动态 / 隐藏”：

- 推荐卡和歌单卡封面角标。
- 搜索结果歌曲、歌手和歌单行。
- 歌单、专辑、歌手详情页标题区域。
- 我的库歌单和收藏分区。
- 播放队列、最近播放和漫游结果。
- 播放栏中的实际播放音源。

视觉规则：

- 徽标使用平台图标、短名称和品牌色，但不让品牌色覆盖应用主视觉。
- 同一分区标题已明确平台时，列表行可只显示紧凑图标；跨平台混排时必须显示文字或可访问名称。
- 不能只靠颜色区分，需提供文本、图标或 `aria-label`。
- 动态模式下实体徽标仅在悬停、键盘聚焦或显式来源语境中出现；隐藏模式下必要控制使用平台文字，不留下空白图标位。
- 播放栏始终显示实际播放来源；当它与内容来源不同时，同时显示“内容来自 X · 当前由 Y 播放”。

### 8.4 宽屏与响应式布局规范

- 页面统一使用 `--sm-content-max-width`、`--sm-reading-max-width` 和 `--sm-page-gutter`，不得再为主页面单独写死 640px/920px 内容上限。
- 探索、我的库和榜单等卡片/列表页面使用内容宽度；歌曲列表可保持更克制的阅读宽度，但必须居中，不能在宽窗口里贴左形成窄列。
- 设置页在宽窗口使用双列控制中心，按功能卡片平衡两列高度；窗口收窄后保持原有语义顺序回落为单列，不横向压缩控件。
- 漫游入口使用左右分区的完整操作面板；已有歌手时，歌手曲库卡片可在宽屏双列排列，生成结果仍保持适合逐行浏览的宽度。
- 内容宽度扩展不等于无上限铺满：超宽窗口保留居中留白，标题、说明文字和表单行继续控制阅读行长。

## 9. 搜索、我的库与漫游

### 9.1 全源搜索

- 对所有已登录、已启用且支持搜索的平台并发请求，单个平台超时不阻塞其他结果。
- 首版按平台分组展示；提供“全部/平台”筛选。
- 搜索结果不自动去重。同名曲目分别显示平台来源，避免错误合并。
- 后续可增加“可能是同一首”的折叠建议，但必须允许展开和纠正。
- 请求应有全局会话号、单平台 `AbortSignal`、并发上限和最短输入防抖。

### 9.2 我的库

- “歌单”只加载全局内容平台的创建/收藏歌单；切换 Dock 后改为目标平台，不在后台并发拉取其他平台的库。
- “收藏”只展示当前内容平台的收藏入口。点击红心默认操作内容来源平台，不自动同步其他平台。
- 我的库与探索页共用同一个全局侧边 Dock 和选择状态，不在页头重复堆叠平台按钮，也不提供“全部平台”。
- “最近播放”继续作为应用本地跨平台记录，记录内容来源和实际播放来源。
- 本地音乐保持独立分区，不参与在线账号能力判断；在“最近播放/本地音乐”切换 Dock 只更新全局选择，返回歌单或收藏时生效。
- 跨平台复制歌单作为后续功能；2.0 首版不在后台静默映射并写入。

### 9.3 漫游

漫游定义为应用自有能力，由三部分组合：

1. **候选生成**：使用带来源的歌手和曲目池。
2. **画像种子**：按能力读取各平台收藏、听歌排行或推荐；缺少某类能力时降级，不隐藏整个漫游。
3. **保存策略**：本地保存是共同基线；平台支持写歌单时才提供同步选项。

2.0 首版规则：

- 用户可选择“全部已启用音源”或某个平台作为候选范围。
- 同名歌手暂不跨平台自动合并；歌手条目显示来源。
- 混合音源生成的漫游歌单保存在本地。
- 只有全部曲目都属于同一平台时，才沿用该平台的远端歌单写入能力。
- 把混合歌单同步到某个平台需要先做全量同曲映射和用户确认，延期到 2.x 后续版本。
- 现有网易云“每日漫游”远端歌单继续可读，迁移后作为单平台保存策略实现。

## 10. 多音源播放解析

### 10.1 播放会话模型

```ts
interface PlaybackResolution {
  originTrack: Track
  resolvedTrack: Track
  actualSource: ProviderId
  quality: QualityOption | null
  url: string
  attempts: PlaybackAttempt[]
  scrobbleTarget: OperationTarget
}

interface PlaybackAttempt {
  source: ProviderId
  trackRef?: EntityRef
  quality?: string
  stage: 'match' | 'resolve' | 'media-load'
  result: 'success' | 'unavailable' | 'restricted' | 'error' | 'cancelled'
  reason?: string
}
```

`PlayerStore` 需要保存 `originTrack` 和当前 `resolution`。现有 `fallbackSource` 迁移为 `resolution.actualSource`，不能再用 `null` 表示“正常音源”，因为 2.0 要始终展示实际来源。

### 10.2 来源尝试顺序

每次加载生成有限的来源顺序：

1. 当前歌曲的一次性手动软优先音源。
2. 若 `preferOriginSource=true`，先尝试内容来源。
3. 按用户配置的 `playbackOrder` 尝试其余已启用音源。
4. 若 `multiSourceFallback=false`，只保留上述顺序的第一个在线音源。
5. 本地曲目只尝试自身文件，不上传、不跨源搜索。

“一次性手动指定”定义为软优先：该平台内部候选耗尽后仍可按策略降级。UI 必须使用“本次优先使用 X”，不得写成容易被理解为硬锁定的“本次只使用 X”。硬锁音源不进入 2.0 首版。

设置页使用“播放接力”表达这组规则，不能只展示一个容易误解的优先级列表：

- 先让用户选择“跟随歌曲来源”或“固定播放顺序”，对应 `preferOriginSource` 的开关状态。
- 跟随来源时，下方列表命名为“跨平台补位顺序”；固定顺序时，列表才表示首选和备用平台。
- 列表支持拖动排序，并为键盘提供 `Alt + ↑/↓` 等价操作；排序只包含已登录且已启用的平台。
- 使用“全局规则”实时概括默认尝试顺序，避免列表顺序与真实起播平台看起来矛盾；单曲“本次优先”仍可临时排在最前。
- `multiSourceFallback` 使用“播放失败后自动换源”呈现，并说明关闭后仍会在当前平台内部降低音质或切换地址。
- 只有一个已启用平台时收起起播方式和自动换源，只显示“唯一音源”；第二个平台启用后再展开完整接力设置。

用户可以在播放栏打开来源菜单：

- 查看当前内容来源和实际播放来源。
- 查看已发现的其他平台候选及可用状态。
- 选择“本次优先使用某平台”。
- 跳转到设置调整全局优先级。

### 10.3 同曲匹配

跨源解析前，先在目标平台搜索等价曲目。2.0 首版冻结以下保守契约；后续调整必须提升匹配缓存 schema：

- 文本先做 Unicode NFKC、小写、全角括号转半角、连续空白与常见标点折叠。
- 艺人按 `/`、`、`、`,`、`&`、`feat.` 拆分后归一化；主要艺人无交集直接拒绝。
- 从标题和专辑提取版本标签集合：`live/现场`、`伴奏/instrumental/karaoke`、`remix/mix`、`翻唱/cover`、`remaster/重制`、`acoustic/不插电`、`demo`。两边集合不一致直接拒绝。
- 两边都有时长且相差超过 3000ms 直接拒绝。
- ISRC 一致且标题基础部分一致：100 分。
- 标题完整归一化一致：55 分；只在移除一致版本标签后基础标题一致：40 分。
- 主要艺人一致：25 分；另有参与艺人交集：5 分。
- 时长差不超过 1000ms：15 分；1001–3000ms：8 分；任一缺时长：0 分。
- 专辑名归一化一致：5 分。
- 自动匹配阈值为 80 分；低于阈值视为无候选，不为了成功率播放可疑歌曲。

匹配缓存：

```text
originSource:originId -> targetSource -> targetId + score + schema + verifiedAt
```

- 自动匹配缓存 TTL 为 30 天；未命中负缓存为 24 小时；缓存携带 schema，匹配算法升级时整体失效。
- 用户手动选中的候选标记为 `userConfirmed`，不受自动阈值和 TTL 影响；目标曲目返回 `NOT_FOUND` 时失效。
- 用户应能清除错误匹配。

### 10.4 单音源内部降级

每个平台的 `PlaybackCapability.resolve()` 返回有序候选，而不是单一 URL。以 QQ“最高”音质为例，候选可以包含不同质量文件名和多个 `sip` 地址。

解析器按以下顺序闭环：

1. 尝试用户请求音质或该平台可用最高音质。
2. URL 为空或明确受限时尝试下一候选。
3. URL 非空但 `AudioEngine` 触发媒体加载错误时，回到解析器尝试同平台下一候选。
4. 该平台候选耗尽后，进入下一个音源。
5. 所有音源耗尽后进入明确失败态；是否自动跳过由独立播放策略决定。

所有尝试必须：

- 受同一个播放会话和 `AbortSignal` 控制。
- 有有限候选和最大尝试数，禁止无限循环。
- 用户切歌后不再产生 toast、状态写入或后台重试。
- 只有媒体实际进入可播放状态后才提交成功解析和磁盘缓存键。
- 试听片段、限制状态和最终失败原因必须可区分。

### 10.5 账号操作与听歌记录

- 红心、取消红心和加入歌单默认作用于内容来源。
- 若用户选择另一个目标平台，必须显式展示平台并先取得可靠同曲候选。
- 听歌记录上报实际播放平台上的 `resolvedTrack.id`。
- 若来源歌单与实际播放平台一致，可携带该平台歌单上下文；否则不把外部平台歌单 ID 发给实际播放平台。
- 歌词默认先取内容来源，失败后可按已解析候选顺序降级；歌词来源应进入诊断信息。

## 11. 聚合层与错误模型

### 11.1 ContentHub

`ContentHub` 是渲染层的编排模块，不是新的服务端网关：

```ts
interface ProviderResult<T> {
  source: ProviderId
  status: 'loading' | 'ready' | 'empty' | 'error'
  data: T
  error?: ProviderError
}

interface ProviderError {
  source: ProviderId
  code: ProviderErrorCode
  message: string
  retryable: boolean
  cause?: string
}
```

职责：

- 获取当前已启用且具备所需能力的平台。
- 控制并发、超时、取消、会话过期和分页游标。
- 用 `ProviderResult` 保留部分成功结果。
- 提供稳定排序，不修改平台内部推荐顺序。
- 不负责跨源同曲匹配；那属于 `PlaybackResolver`。

### 11.2 错误分类

```ts
type ProviderErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_CHANGED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RESTRICTED'
  | 'NOT_FOUND'
  | 'UNKNOWN'
```

- 页面用错误类型决定登录、重试、隐藏或提示，不再全部 `.catch(() => {})`。
- 平台结构变化应记录为 `UPSTREAM_CHANGED`，便于定位逆向接口失效。
- 日志禁止记录 cookie、完整签名音频 URL 和其他凭证。
- 聚合失败按栏目展示；播放失败按尝试链展示用户可理解的最终原因。

## 12. 缓存与持久化

- 实体缓存键继续使用 `source:id`。
- 推荐缓存增加 `source:surfaceId:cursor`，不同平台 TTL 可不同。
- 同曲匹配缓存与播放 URL 缓存分离；URL 有时效，匹配关系相对长寿。
- 音频磁盘缓存按实际播放曲目的 `source:id:quality` 分键。
- 队列持久化保存内容来源，不保存过期 URL；当前解析结果只保存可诊断信息，重启后重新解析。
- 最近播放可同时保存 `originTrackRef` 与上次 `actualTrackRef`，再次播放仍按当前优先级重新决策。
- 设置、播放态、漫游和匹配缓存分别带 schema，迁移失败时只重置对应域。

## 13. 服务端与登录层

### 13.1 服务端

- 保持 `server/routes/netease.ts`、`server/routes/qq-music.ts` 的平台隔离。
- 各平台 client 负责上游字段、防御式解析和平台内音质候选生成。
- 通用音频代理、磁盘缓存和错误信封继续共享。
- 新平台增加独立 route/client 文件，在 provider 注册表中接入渲染层。
- 对播放接口逐步返回结构化限制、质量候选和可诊断错误，避免只返回空字符串。

### 13.2 登录与账号

- 账号菜单改为“音源与账号”管理：每个平台有启用开关、登录状态、昵称和登录/退出操作。
- 登录和退出只影响一个平台，不改变其他平台优先级。
- 顶栏不再用某个“当前音源头像”；可以显示应用头像入口，并在菜单内列出多个账号。
- Electron 的独立 session 分区继续保留，未来登录适配也通过 provider descriptor 注册。

## 14. 代码影响范围

### 14.1 新增核心模块（建议命名）

```text
src/providers/
  types.ts
  registry.ts
  netease-provider.ts
  qq-provider.ts

src/lib/content-hub.ts
src/lib/playback-resolver.ts
src/lib/track-matcher.ts
src/stores/providers.ts
```

### 14.2 主要迁移点

| 区域 | 当前入口 | 目标变化 |
|---|---|---|
| 音源选择 | `stores/settings.ts` | 移出 `activeSource`，引入 provider store 与优先级 |
| 服务获取 | `useMusicService.ts`、`service-registry.ts` | 分别变为聚合查询和按实体来源取 provider |
| 内容平台 | `stores/providers.ts`、`GlobalContentProviderDock.tsx` | 保存探索与我的库共用的全局浏览来源，并通过侧边 Dock 切换 |
| 探索页 | `ExplorePage.tsx` | 按全局内容平台渲染独立推荐视图 |
| 搜索 | `TopBar.tsx`、`SearchBar.tsx` | 并发查询已启用 provider |
| 我的库 | `LibraryPage.tsx` | 只请求全局内容平台的歌单与收藏，不再使用页面内来源筛选 |
| 漫游 | `stores/roam.ts`、`RoamPage.tsx` | 候选来源、画像来源、保存策略拆分 |
| 播放 | `stores/player.ts`、`track-fallback.ts` | 替换为 N 音源 `PlaybackResolver` |
| 音频引擎 | `audio-engine.ts` | 媒体错误回传解析器，支持有限重试 |
| 缓存/预载 | `track-preload.ts`、`playback-persistence.ts` | 按实际播放实体和新 schema 迁移 |
| 来源 UI | 卡片、行、详情页、播放栏 | 统一使用 `SourceBadge`/`SourceSelector` |

禁止以“一次性全局替换”完成迁移。每一阶段都应保留可运行的兼容适配层，并有清晰删除条件。

## 15. 分阶段交付

### 阶段 A：架构地基（`2.0.0-alpha.1`）

- 建立 provider registry、能力协议和 provider store。
- 将现有网易云、QQ service 包装为 provider，行为暂不改变。
- 引入设置 schema 迁移和 `source:id` 统一键工具。
- 保留 `useMusicService()` 兼容层，仅供尚未迁移页面使用。
- 建立 provider 契约测试。

退出条件：

- [ ] 网易云、QQ provider 通过同一套 catalog/playback 契约测试。
- [ ] 测试 provider 可注册并被枚举，业务组件不增加平台名称条件分支。
- [ ] `activeSource × crossSourceFallback` 四种旧设置组合均有迁移测试，重复迁移幂等。
- [ ] 尚未迁移的页面通过兼容层保持现有行为，`npm run typecheck` 与 `npm test` 全部通过。

### 阶段 B：内容融合（`2.0.0-alpha.2`）

- 设置和账号菜单改为多音源启用。
- 建立探索页与我的库共用的全局内容平台；搜索继续多平台聚合。
- 全面补齐歌单、歌曲、详情页来源徽标。
- 漫游完成候选生成与保存策略拆分，但暂不做跨平台远端同步。

退出条件：

- [ ] 同时启用网易云和 QQ 时，侧边 Dock 的一次切换会同步改变探索页与我的库，搜索仍可展示两边结果。
- [ ] 关闭任一平台后，新请求、推荐栏目和播放候选均不再包含它。
- [ ] 任一平台超时、登录失效或返回空数据时，另一平台结果不被清空。
- [ ] 第 8.3 节列出的页面均通过来源标识组件检查，并覆盖键盘/读屏名称。
- [ ] 混合漫游只写本地；单平台漫游仍能按对应保存策略读取和生成。
- [ ] 聚合层部分成功、取消和独立分页测试通过。

### 阶段 C：播放融合（`2.0.0-beta.1`）

实现记录见 [`2026-08-13-simple-music-2.0-phase-c-playback-fusion.md`](./2026-08-13-simple-music-2.0-phase-c-playback-fusion.md)。代码与自动化检查已完成，真实双账号播放矩阵尚未验收。

- 引入 `PlaybackResolver`、来源优先级和一次性手动选择。
- 实现同曲匹配评分与缓存。
- 音频引擎媒体错误回到解析器。
- 实现平台内音质降级、多个地址尝试和跨平台降级。
- 修正实际曲目缓存键、听歌上报和来源展示。

退出条件：

- [x] 手动软优先、原源优先开关、`playbackOrder` 和 `multiSourceFallback` 的组合顺序有确定性测试。
- [x] 同平台质量/地址候选、媒体加载失败和跨平台降级按有限顺序执行。
- [x] 用户切歌或禁用音源后，旧会话全部取消且不得写回状态。
- [x] 缓存、听歌上报和播放栏使用实际解析曲目的 source/id。
- [ ] 真实双账号完成第 16.2 节播放样本验证。

### 阶段 D：稳定与发布（`2.0.0-rc.1` → `2.0.0`）

实现记录见 [`2026-08-13-simple-music-2.0-phase-d-stabilization.md`](./2026-08-13-simple-music-2.0-phase-d-stabilization.md)。旧模型清理、持久化迁移、全量自动化与生产构建已完成；独立复审与真实双账号矩阵仍是发布闸门。

- 清理 `activeSource`、二元 `otherSource()` 和旧 `fallbackSource`。
- 完成持久化迁移、恢复态、禁用音源和登录过期测试。
- 补充请求节流、错误诊断、无障碍来源标识与性能检查。
- 更新顶层架构、播放系统、README 和发行说明。

退出条件：

- [x] 生产代码不再读取 `activeSource`、调用二元 `otherSource()` 或保存旧 `fallbackSource`；旧字段只在一次性迁移解析中出现。
- [ ] 第 16.2 节人工矩阵与第 17 节全部验收项有结果记录。
- [ ] `npm run typecheck`、`npm test` 和双登录真实环境冒烟通过。
- [ ] 1.x 设置原文备份保留到 2.0.0 稳定迁移成功，迁移失败可恢复旧设置；各阶段有独立提交边界和发布标签可回退。
- [x] 顶层架构、播放系统、README 和发行说明草案已与实现同步。

## 16. 测试策略

### 16.1 自动化测试

- **Provider 契约**：字段归一、能力声明、复合身份和错误分类。
- **设置迁移**：1.x `activeSource/crossSourceFallback` 到新 schema。
- **ContentHub**：部分成功、乱序返回、禁用中取消、独立分页和失败重试。
- **同曲匹配**：同名异歌、Live/伴奏/Remix、缺时长、多艺人和用户确认缓存。
- **PlaybackResolver**：优先级、原源优先、同源降质、跨源、最大尝试数、切歌取消。
- **AudioEngine**：非空 URL 的媒体错误能回调，不会永久停在 loading。
- **写操作路由**：红心、歌单和听歌记录使用正确目标 source/id/context。
- **持久化**：混合队列恢复、禁用来源后的恢复和旧 schema 降级。
- **组件**：来源徽标、平台筛选、部分错误和来源选择菜单。

### 16.2 人工验证矩阵

至少覆盖：

| 网易云 | QQ | 场景 |
|---|---|---|
| 启用且登录 | 启用且登录 | 探索页平台切换、歌单、搜索、播放优先级 |
| 未登录 | 启用且登录 | 不产生网易请求、内容、标识或播放候选 |
| 禁用 | 启用且登录 | 不产生网易请求或候选 |
| 启用但接口失败 | 启用正常 | QQ 内容和播放不受影响 |
| 启用且登录 | 启用但播放受限 | 自动回到网易候选 |

播放人工样本必须包含：

- 两个平台都可播。
- 首选平台无版权、第二平台可播。
- 高音质地址不可加载、低音质可播。
- 返回非空 URL 但媒体元素报错。
- 同名不同版本，不得自动错配。
- 快速连续切歌，旧解析不得覆盖新曲。

## 17. 验收标准

2.0.0 发布至少满足：

- [ ] 设置中不存在互斥的“当前音源”，网易云和 QQ 可同时启用并保持登录。
- [ ] 探索页与我的库按同一个全局内容平台展示；两个及以上平台使用侧边半隐藏 Dock 切换，不存在“全部平台”，单平台用户不显示多余控件。
- [ ] 在探索或我的库切换平台后，进入另一个页面仍保持该选择；当前平台失效时安全回退到其他参与平台。
- [ ] 来源标识支持常显、动态和隐藏；无论视觉密度如何，关键控制仍可理解。
- [ ] 全源搜索支持部分成功；任一平台错误不会清空另一平台结果。我的库单平台失败可独立重试。
- [ ] 播放器始终展示实际播放来源，来源变化有明确状态而不只是一闪而过的 toast。
- [ ] 用户可持久化调整播放优先级，并可对当前曲目做一次性覆盖。
- [ ] 播放失败顺序为“同平台候选/降质 → 下一平台”，次数有限且可取消。
- [ ] 红心、写歌单和听歌上报不会把一个平台的 ID 发送到另一个平台。
- [ ] 1.x 设置和混合播放队列可以安全迁移或可解释地降级。
- [ ] `npm run typecheck`、`npm test` 通过，并完成双登录真实环境冒烟。
- [ ] 注册测试第三音源时，探索页和播放链不需要新增平台名称条件分支。

## 18. 风险与缓解

| 风险 | 级别 | 缓解 |
|---|---:|---|
| 跨源匹配播放错版本 | 高 | 高阈值、版本词惩罚、有限候选、用户确认与清除映射 |
| 非官方接口改版 | 高 | provider 隔离、结构化 `UPSTREAM_CHANGED`、单平台失败隔离 |
| 聚合场景同时请求多平台导致限流或变慢 | 中高 | 探索和我的库只请求全局内容平台；全源搜索使用并发上限、独立缓存与按需加载 |
| 写操作落到错误平台 | 高 | `PlaybackContext`/`EntityRef` 复合身份、显式操作目标、契约测试 |
| 迁移期间双模型并存产生竞态 | 中高 | 分阶段兼容层、会话号、逐页面迁移、阶段退出条件 |
| 来源徽标造成界面拥挤 | 中 | 分区内紧凑图标、混排时完整徽标、统一组件 |
| 多次降级导致起播延迟 | 中 | 原源优先默认、匹配缓存、候选预解析、有限超时 |
| 上游版权和账号等级差异 | 中 | 结构化限制原因、实际音质展示、不承诺必然可播 |

## 19. 与现有 Issues 的关系

### Issue #2：QQ 歌词错配

该问题的根因线索是 QQ `mid/qqId` 混用，属于平台适配器内部身份正确性。它不依赖 2.0，可以在 1.x 先修并补回归测试；修复后的标识规则直接被 QQ provider 复用。

### Issue #3：音质和播放失败恢复

该问题暴露了当前播放器只在“解析不到 URL”时换源、无法处理“URL 非空但媒体加载失败”。不建议只在旧二元链路上堆叠补丁；其媒体错误收敛可以先做最小修复，完整的音质候选、地址重试和多音源降级纳入阶段 C。

## 20. 延期项

以下进入 2.x 后续路线，不阻塞 2.0.0：

- 跨平台搜索结果的可撤销合并。
- 跨平台红心和歌单复制向导。
- 混合漫游歌单同步到指定平台。
- 根据历史成功率自动调整单曲来源优先级。
- 允许用户维护永久同曲映射。
- 第三个线上音源接入。
- 跨设备同步应用自身的匹配缓存和混合歌单。

## 21. 待确认问题

以下问题不阻塞架构地基，但应在对应阶段开始前确认：

1. 已决策：升级后只迁移原 `activeSource`，其他平台登录后仍需用户明确启用。
2. 已决策：探索页与我的库取消跨平台混排和“全部平台”；两个及以上参与平台通过全局侧边 Dock 同步切换浏览来源。
3. `preferOriginSource` 是否保留为默认策略，还是严格服从用户排序。
4. 最终失败后是否自动跳到下一首，以及连续自动跳过的上限。
5. 混合漫游的默认候选范围是“全部启用音源”还是记住用户上次选择。
6. 红心按钮是否只操作内容来源，还是点击后弹出目标平台选择；本提案默认直接操作内容来源。

## 22. 下一步

1. 解锁真实窗口后补齐阶段 B.1 的界面验收。
2. 用网易云与 QQ 双账号完成阶段 C 的播放样本矩阵，记录上游真实限制与失败原因。
3. 进入阶段 D，清理旧二元兼容字段并完成发布稳定性检查；1.x 修复线继续独立处理 Issue #2。
