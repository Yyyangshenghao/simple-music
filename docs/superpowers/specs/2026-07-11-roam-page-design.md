# 「漫游」页设计:按歌手临时混播歌单

日期:2026-07-11
状态:已确认设计,待实现

## 背景与需求

用户想要一个"今天想听哪几个歌手就临时攒一份歌单"的场景:选几位歌手 → 生成一份混合歌单当天听 → 不写回网易云/QQ 音乐账号,不污染用户真实歌单。定位为与「探索」「我的库」同级的第三个一级页面,页面名「漫游」。

## 已确认的关键决策(逐条来自与用户的澄清)

- 歌手来源:搜索添加(复用现有搜歌手能力),不依赖"最近播放/关注"。
- 选曲策略:默认取每位歌手的热门曲目,可整体切换为"随机"模式(从该歌手曲库池里洗牌抽取)。
- 生命周期:仅当天有效,跨自然日或手动重新生成即视为过期/覆盖,不做长期歌单管理。
- 入口:新增一级页面「漫游」,与探索页、我的库同级挂在顶部导航。
- 跨音源:同一份漫游歌单只能选**当前激活音源**(`settings.activeSource`)下的歌手,不做网易云/QQ 混选;切换音源后视为过期,需要重新选歌手。
- 规模:最多 5 位歌手 × 每人 10 首,总量约 50 首封顶,不新增可调节 UI。
- 播放顺序:汇总后整体 shuffle,不按歌手分块、不按选择顺序排列。

## 关键技术事实(设计依据)

- `MusicService.getArtistSongs(id)` 已存在且两个音源都已实现,一次返回该歌手约 50 首按热度排序的曲目(`server/routes` 侧网易 `limit: 50`、QQ 无显式上限但实测同量级),**不需要新增后端接口**:"热门"取返回列表前 10,"随机"从这批约 50 首里洗牌取 10。
- `MusicService.searchArtists(keyword)` 已存在,`TopBar.tsx` 已有调用示例(第 112 行 `navigateTo({ type: 'artist', ... })`),漫游页搜索歌手直接复用。
- `src/stores/recent.ts` 是"本地专属、跨音源无关、localStorage 持久化、不依赖登录"类 store 的既有范式,漫游 store 照此模式实现即可,不必另创模式。
- `AppView`(`src/stores/navigation.ts`)是简单联合类型,新增字面量成员 `'roam'` 成本很低;`TopBar.tsx` 的导航项是 `{ label, view }` 数组,追加一项即可接入。
- 曲目量级(≤50)远小于 `PlaylistDetailView` 设计针对的懒加载/虚拟列表场景(500+ 首),复用它是过度设计;直接用 `TrackRow` 平铺渲染即可。

## 设计

### 1. 数据模型与持久化(新增 `src/stores/roam.ts`)

```ts
interface RoamPlaylist {
  date: string          // 本地日期 'YYYY-MM-DD',生成时写入
  source: MusicSource   // 生成时的 activeSource
  mode: 'hot' | 'random'
  artists: ArtistInfo[] // 已选歌手,最多 5 位
  tracks: Track[]       // 汇总 + shuffle 后的最终曲目,最多 50 首
}
```

- localStorage key:`simplemusic-roam-playlist`,只存**一份**(不做历史归档,符合"仅当天有效"的定位)。
- 读取时校验:`date !== 今天` 或 `source !== 当前 activeSource` → 视为过期,store 状态回到"未生成"(`playlist: null`),页面据此渲染选歌手态,不额外弹提示。
- store 形状参考:
  ```ts
  interface RoamStore {
    playlist: RoamPlaylist | null   // null = 未生成或已过期
    selectedArtists: ArtistInfo[]   // 选歌手态下的进行中选择(不持久化,页面内 state 亦可,视实现选择)
    mode: 'hot' | 'random'
    addArtist(artist: ArtistInfo): void   // 上限 5,超出忽略
    removeArtist(id: unknown): void
    setMode(mode: 'hot' | 'random'): void
    generate(): Promise<void>   // 按 selectedArtists × mode 拉取 getArtistSongs、截取、汇总、shuffle、写 localStorage
    reset(): void   // 清空 playlist,回到选歌手态
  }
  ```

### 2. 页面与交互(新增 `src/pages/RoamPage.tsx` + `.module.css`)

单页两态,不引入子路由:

**选歌手态**(`playlist === null` 或已过期):
- 顶部搜索框,复用 `searchArtists(keyword)`(按 `activeSource` 走对应 service,与 `useMusicService()` 一致,因为此时还没有"已生成歌单"跨音源的问题)。
- 搜索结果列表,点击加入已选 chips;达到 5 人上限后,未选中的搜索结果项置灰不可点(不用 toast 打扰)。
- 已选 chips 支持点击移除。
- 模式切换(热门 / 随机),整体生效,非逐歌手可调。
- 底部"生成漫游歌单"按钮:`selectedArtists.length === 0` 时禁用;点击调用 `generate()`。

**结果态**(`playlist !== null` 且未过期):
- 顶部信息条:"今日漫游 · N 位歌手 · M 首" + "重新选择"按钮(调用 `reset()` 回到选歌手态,不清 localStorage 之外的东西,纯前端状态切换)。
- 曲目列表用 `TrackRow` 平铺渲染(非虚拟列表,量级 ≤50 无需要),点击播放调用 `usePlaylistStore.getState().setQueue(playlist.tracks, index)`。

### 3. 生成逻辑(`generate()` 内部)

```
for each artist in selectedArtists:
  songs = await serviceFor(activeSource).getArtistSongs(artist.id)
  picked = mode === 'hot' ? songs.slice(0, 10) : shuffle(songs).slice(0, 10)
  // 某歌手曲库不足 10 首:有多少取多少,不报错、不补位
all = picked 汇总(flat)
tracks = shuffle(all)
写入 { date: today(), source: activeSource, mode, artists: selectedArtists, tracks }
```

- `shuffle` 用简单 Fisher–Yates,放进 `src/lib/` 下的小纯函数(如 `array-utils.ts` 或直接内联于 `roam.ts`,视实现时机判断是否值得单独抽出并配单测)。
- 5 位歌手的 `getArtistSongs` 请求并行发起(`Promise.all`),不用会话计数守卫(本页面无跨页竞态场景:生成过程中用户离开页面不影响下次读取到的最终结果,是否需要"离开页面时丢弃在途请求"留给实现阶段按简单性判断)。

### 4. 播放集成

- 复用现有队列机制:`usePlaylistStore.getState().setQueue(tracks, index)`,与 `PlaylistDetailView`、`ExplorePage` 等现有调用方式一致。
- 每首 `Track` 自带 `source` 字段(生成时就是 `activeSource`,理论上全部同源),播放/取 URL 走 `serviceFor(track.source)`,天然满足 CLAUDE.md 的绑源约定(此处虽然单一音源,仍遵循统一模式而非另开分支)。

### 5. 导航接入

- `src/stores/navigation.ts` 的 `AppView` 联合类型新增字面量 `'roam'`。
- `src/components/Layout/TopBar.tsx` 的导航项数组追加 `{ label: '漫游', view: 'roam' }`。
- `App.tsx` / `AppShell.tsx` 按 `currentView === 'roam'` 渲染 `RoamPage`(参照现有 explore/library/settings 的分发写法)。

### 6. 边界情况

| 场景 | 行为 |
|---|---|
| 某歌手曲库不足 10 首 | 有多少取多少 |
| 应用重启后当天再次打开「漫游」 | localStorage 命中且未过期 → 直接恢复结果态 |
| 生成后切换音源再切回来 | `source` 不匹配 → 过期 → 回到选歌手态(即使切回原音源当天也需重新生成,符合"该次生成绑定当次音源"的简单模型) |
| 已选满 5 人时继续搜索 | 搜索仍可用,结果项对未选中歌手置灰禁用 |
| `getArtistSongs` 请求失败(单个歌手) | 该歌手贡献 0 首,不阻断其余歌手 / 不阻断生成流程(仅做最小容错,不做整体失败重试 UI) |

## 明确不做(YAGNI)

- 不做跨音源混选。
- 不做历史多份漫游歌单归档/回看。
- 不做逐歌手可调曲目数量的精细化 UI。
- 不新增后端接口(完全复用现有 `getArtistSongs`)。
- 不引入虚拟列表/懒加载(数据量级不需要)。
- 不支持把漫游歌单收藏/同步为真正的平台歌单(明确违背用户"不污染真实歌单"的初衷)。

## 测试与验证

- vitest:`generate()` 核心逻辑抽出的纯函数(每歌手取样 + shuffle + 汇总)单测;localStorage 过期校验(日期/音源不匹配)单测,风格参照 `stores.test.ts` / `likes.test.ts`。
- `npm run typecheck` + `npm test` 全过。
- Electron 实测(沿用 [[explore-stack-redesign]] 记录的 playwright-core 方法):搜索加歌手、生成、播放、重启应用后状态恢复、切音源后过期这几条路径手动走一遍。
