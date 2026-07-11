# 「漫游」页改版:网易云侧写回真实歌单

日期:2026-07-11
状态:已确认设计,待实现
接续/修订:[[2026-07-11-roam-page-design.md]](./2026-07-11-roam-page-design.md)(原「纯本地临时歌单」设计,已实现并合并到 master,commit 范围 164923e..a8e9875)

## 背景与变更动机

原设计里「漫游」歌单是纯本地 localStorage 存档,不写回任何平台账号。用户体验后改主意:反正都是该音源本来就能听的歌,不如直接建成账号里一个真实歌单,方便在其他客户端/设备上也能看到今天的漫游结果。本次只改造 **网易云** 一侧;**QQ 音乐维持现在已上线的纯本地方案不变**,QQ 写歌单能力留作后续独立任务(用户已明确"QQ 的先不管,后面会做的")。

## 已确认的关键决策

- **仅网易云改造**,QQ 分支代码不动。
- **歌单名固定为「每日漫游」**,建为 **隐私歌单**(`privacy=10`),不出现在公开歌单列表里。
- **归属识别**靠简介里的水印字符串 `Simple Music`,不靠歌单名单独判断(名字可能撞车)。
- **简介格式**:`Simple Music · YYYY-MM-DD · 歌手A/歌手B/歌手C`(水印/日期/歌手名单三段,用 ` · ` 分隔,便于正则解析;歌手名单之间用 `/` 分隔)。
- **同名无水印冲突**:账号里已有同名但简介无水印的歌单(比如用户自己手动建的)→ 视为不是本应用创建的,**另建一个新的**,不touch 已有的那个。
- **未登录**:网易云未登录时,「漫游」页直接显示禁用态(不做任何请求),不提供本地兜底。
- **本地只缓存歌单 id**(`localStorage`,永不主动过期删除,除非按 id 查不到歌单了才清掉重新走查找流程)——不再缓存曲目数据本身,曲目永远来自这个真实歌单的实时内容。
- **同一个歌单实体永久复用**:每次"生成"都是复用同一个歌单 id,清空曲目重新塞入 + 覆盖简介,不是每天新建一个歌单。

## 识别与生成流程

### 打开「漫游」页(netease 音源)

1. `settings.neteaseLoggedIn === false` → 渲染禁用态(提示需要登录),不发任何请求。
2. 已登录,本地缓存里有歌单 id:
   - 按 id 拉这个歌单的简介 + 曲目。
   - 简介能解出水印 `Simple Music` 且日期 = 今天 → 直接进入结果态,播放这个真实歌单当前的曲目。
   - 水印缺失,或日期解不出来,或日期不是今天 → 视为过期,回到选歌手态(生成时复用同一个 id)。
   - 按 id 查不到歌单(被删除)→ 清空本地缓存的 id,转入下面"无缓存"分支。
3. 本地缓存里没有歌单 id:
   - 拉账号歌单列表,找 `name === '每日漫游'` 且简介包含水印 `Simple Music` 的第一条。
   - 命中 → 缓存其 id,回到第 2 步的"有缓存"逻辑继续判断日期。
   - 未命中(不存在,或存在但无水印)→ 进选歌手态,等用户点"生成"时新建。

### 点击"生成"

- 已确认存在可复用的歌单(上面流程中已定位到 id)→
  1. 取出该歌单当前的全部曲目 id(刚才识别阶段已经一并拉到)。
  2. 全部删除(`playlist_tracks op=del`,一次请求批量删)。
  3. 把新选出的曲目(≤50 首,选曲/洗牌逻辑不变,仍用已实现的 `src/lib/roam-selection.ts`)`op=add` 批量加入。
  4. 用新的 `Simple Music · 今天日期 · 歌手名单` 覆盖简介。
- 没有可复用的歌单(首次使用 / 之前的被删了)→
  1. `playlist_create`(name=`每日漫游`,privacy=`10`)。
  2. 新 id 写入本地缓存。
  3. 同上:批量加入曲目 + 写简介。

## Server 改动

- `/api/user/playlists`(`server/routes/netease.ts` 约第 439-451 行):`list` 的 map 里补上 `description: asStr(pl.description)`(上游 `user_playlist` 每项本身带 `description` 字段,此前未透出)。
- `/api/playlist/tracks`(约第 815-836 行 `playlistMeta` 构造处):同样补上 `description` 字段(来源 `playlist_detail` 返回的 `pl.description`)。
- 新增 `POST /api/playlist/desc/update`:body `{ id, desc }`,直接映射上游 `playlist_desc_update({ id, desc, cookie })`(该上游 module 在 `NeteaseCloudMusicApi/module/playlist_desc_update.js` 已存在,未被此项目使用过)。
- 新增 `POST /api/playlist/remove-songs`:body `{ pid, ids }`(`ids` 为逗号分隔的曲目 id 字符串),映射 `call('playlist_tracks', { op: 'del', pid, tracks: ids, cookie, timestamp })`——结构上直接参照现有 `/api/playlist/add-song`(约第 561-611 行)的写法,但不需要它那套 `playlist_track_add` 兜底(该兜底只在 `add` 语义下有对应的旧版兼容接口 `playlist_track_add`,`del` 没有对应旧接口,失败就直接报错即可)。
- `/api/playlist/add-song` **不需要改动**:其 `id`/`ids` 参数已经支持传入逗号分隔的多个 id(`tracks: String(id)`,上游模块内部 `query.tracks.split(',')`),批量加入 50 首直接传 `ids: "123,456,..."` 即可复用现有路由。

## 渲染层改动

### `MusicService` 接口新增可选方法(仅网易实现,QQ 不实现)

参照现有 `getDailySongs?`/`getRadarPlaylist?` 的"可选方法,未实现的音源不走该分支"模式:

```ts
/** 按名字查账号歌单(可选;仅网易实现,漫游功能用于识别归属)。找不到返回 null。 */
findUserPlaylistByName?(name: string): Promise<Playlist | null>
/** 建歌单(可选)。 */
createPlaylist?(name: string, opts: { private: boolean }): Promise<Playlist>
/** 清空并替换歌单全部曲目(可选)。 */
replacePlaylistTracks?(playlistId: unknown, trackIds: unknown[]): Promise<boolean>
/** 覆盖歌单简介(可选)。 */
updatePlaylistDescription?(playlistId: unknown, description: string): Promise<boolean>
```

(以上方法名/签名到写实现计划时可按现有代码风格微调,原则不变:只在 `netease-music-service.ts` 里实现,`qq-music-service.ts` 不声明。)

### `roam` store 分流

`generate()`/打开页面时的识别逻辑,按 `service.createPlaylist` 是否存在分流:
- 存在(netease)→ 走本文档"识别与生成流程"这一整套真实歌单逻辑。
- 不存在(QQ)→ 完全复用现有已上线的本地 localStorage 逻辑(`src/stores/roam.ts` 现有代码,不改)。

本地缓存 key 需要新增一个「网易云漫游歌单 id」专用 key(如 `simplemusic-roam-playlist-id-netease`),与 QQ 现有的 `simplemusic-roam-playlist`(整份歌单数据)是两套独立存档,互不影响。

### `RoamPage.tsx` 新增状态

- 未登录禁用态(`settings.neteaseLoggedIn === false` 且 `activeSource === 'netease'`)。
- 选曲/结果两态的判定逻辑与曲目来源改为上面流程描述的"识别真实歌单"结果,而不是直接读本地 `playlist.tracks`。

## 明确不做(YAGNI)

- 不做 QQ 音乐写歌单能力(后续独立任务)。
- 不做隐私/公开可配置(固定隐私歌单)。
- 不做多份历史漫游歌单归档(同一个歌单实体永久复用,不新建"每日漫游 2"这类)。
- 同名无水印冲突不做合并/接管逻辑,只新建。
- 不做"手动把这个歌单重命名/删除后如何找回"的额外提示 UI(按上面流程,查不到就静默转入选歌手态/新建,不打扰用户)。

## 测试与验证

- 沿用 `src/lib/roam-selection.ts` 现有单测(选曲逻辑不变,无需新增)。
- 新增:简介格式的构造/解析纯函数(拼装 `Simple Music · date · 歌手/歌手`、从简介反解水印/日期/歌手名单)单测。
- `roam.ts` store 新增网易分支的单测(mock `createPlaylist`/`findUserPlaylistByName`/`replacePlaylistTracks`/`updatePlaylistDescription`),覆盖:无缓存命中已有歌单、无缓存且无命中新建、有缓存同日直接读、有缓存跨日过期重新生成、缓存 id 查无歌单清缓存重新走查找。
- `npm run typecheck` + `npm test` 全过。
- 有真实登录态时做一次 Electron 实测:生成 → 网易云官方客户端/网页版确认「每日漫游」歌单确实出现且为隐私、简介格式正确、曲目一致。
