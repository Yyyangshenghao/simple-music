# QQ 音乐探索页数据源补齐 设计

日期:2026-07-10

## 背景

探索页(`src/pages/ExplorePage.tsx`)对网易云音源有三块内容:推荐歌单 Stack(可无限翻页)、"每日推荐"曲目卡、"私人雷达"歌单卡。QQ 音乐音源当前只有 Stack 一块,且数据来源是登录用户自己的创建+收藏歌单(`/api/qq/user/playlists`)退化实现,没有真分页,也没有每日推荐/雷达卡片。

`docs/qq-music-api.md` 第 3 节已交叉核对出 QQ 侧对应上游能力,并给出接入优先级:雷达推荐(`GetRadarSong`)→ 推荐歌单(`GetRecommendFeed`)→ 猜你喜欢(`get_radio_track`)。本次一次性补齐这三块,让 QQ 探索页在结构上对齐网易云。

三个上游接口均为逆向、无官方文档的接口,本地开发环境没有真实 QQ 登录态可供联调测试,字段解析按第三方库(`l-1124/QQMusicApi` 等)交叉核对的最佳猜测实现,采用项目里一贯的宽松/多候选字段名解析风格,但**上线前必须由持有真实 QQ 登录 cookie 的人在运行中的 app 里实测三个接口**,字段名如有出入需要照实际响应调整。

## 目标

1. 推荐歌单 Stack 的数据源从"登录用户自己的歌单"改为 QQ 官方推荐歌单流(`music.playlist.PlaylistSquare/GetRecommendFeed`),对齐网易云"page 0 = 个性化,page ≥ 1 = 热门翻页"的分页语义,不再要求登录。
2. 新增"猜你喜欢"曲目卡(`music.radioProxy.MbTrackRadioSvr/get_radio_track`),复用网易"每日推荐"卡片位置,标题按音源区分文案。
3. 新增"私人雷达"歌单卡(`music.recommend.TrackRelationServer/GetRadarSong`),复用现有 `RadarPlaylist` 接口与 UI,两音源文案一致。

## 非目标(本次已知不做)

- "我的库"歌架(`ShelfScene` / `usePlaylistStore.loadUserPlaylists`)目前硬编码调用网易云 `/api/user/playlists`,与 `activeSource` 无关。QQ 用户自己创建/收藏的歌单(原先靠 Explore Stack 顶替曝光)在本次改动后将失去入口,这是已知缺口,留待后续独立需求处理,不在本次范围内。
- 不处理"发现页综合流"(`music.recommend.RecommendFeed/get_recommend_feed`)、排行榜、相似歌手/歌曲等 `docs/qq-music-api.md` 第 2 节列出的其他未接入接口。

## 架构设计

### Server 端

**`server/lib/qq-client.ts`** 新增三个 handler,风格与现有 `handleQQUserPlaylists`/`handleQQArtistSongs` 一致(`qqMusicRequest` 统一信封、`rec`/`arr`/`str`/`numOf` 防御式取值、未登录/空数据走兜底分支而不抛错):

- `handleQQRadarSong(cookie, page)`:
  - 先查 `getQQLoginInfo`,未登录直接返回 `{ provider:'qq', playlist:null, tracks:[] }`(与网易 `/api/netease/radar` 同构)。
  - 调 `music.recommend.TrackRelationServer/GetRadarSong`,取曲目列表(复用 `mapQQTrack` 映射单曲字段)。
  - 上游只给曲目、没有歌单实体,服务端合成一个轻量 playlist 壳:`{ provider:'qq', id:'qq-radar', name:'私人雷达', cover: <首曲专辑封面>, trackCount, creator:'QQ 音乐' }`。
  - 曲目为空则返回 `playlist:null`(前端按此隐藏卡片,与网易一致)。

- `handleQQRecommendFeed(cookie, page)`:
  - 调 `music.playlist.PlaylistSquare/GetRecommendFeed`,参数 `From = page * 20, Size = 20`。
  - 响应体里歌单数组位置未知,按已知候选字段尝试提取(`data.content`/`data.List`/`data.v_playlist`/`data.playlist`),取到数组后用现有 `mapQQPlaylist(item, 'discover')` 映射,过滤 `id && name`。
  - 不要求登录;拿不到数据时返回空数组而非报错(参照 `handleQQArtistAlbums` 的失败兜底写法)。

- `handleQQRecommendSongs(cookie)`:
  - 未登录返回 `{ provider:'qq', songs:[] }`。
  - 循环调用 `music.radioProxy.MbTrackRadioSvr/get_radio_track`,最多 4 次;每次结果按 `mid` 去重累加,累计满 20 首或某次返回空列表则提前停止。
  - 曲目映射复用 `mapQQTrack`。

**`server/routes/qq-music.ts`** 新增三条路由:

- `GET /api/qq/radar` → `handleQQRadarSong`
- `GET /api/qq/recommend/playlists?page=` → `handleQQRecommendFeed`(`page` 缺省 0,非负整数)
- `GET /api/qq/recommend/songs` → `handleQQRecommendSongs`

路由内 try/catch + `console.error` 兜底 500,与现有路由风格一致。

### Client 端

**`src/lib/qq-music-service.ts`**:

```ts
async getRecommendPlaylists(page = 0): Promise<Playlist[]> {
  const res = await api.get<{ playlists: Playlist[] }>('/api/qq/recommend/playlists', { page })
  return res.playlists ?? []
}

async getDailySongs(): Promise<Track[]> {
  const res = await api.get<{ songs: Track[] }>('/api/qq/recommend/songs')
  return res.songs ?? []
}

async getRadarPlaylist(): Promise<RadarPlaylist | null> {
  const res = await api.get<{ playlist: Playlist | null; tracks: Track[] }>('/api/qq/radar')
  if (!res.playlist || !res.tracks?.length) return null
  return { playlist: res.playlist, tracks: res.tracks }
}
```

删除现有靠 `/api/qq/user/playlists` 顶替的 `getRecommendPlaylists` 实现与其上的中文注释(不再需要,新实现直接对齐 `MusicService` 接口文档里"可无限翻页"的语义)。

**`src/lib/music-service.ts`**:`getDailySongs`/`getRadarPlaylist` 的接口注释目前写"网易专属",需要更新措辞(QQ 现在也实现了),避免文档与实现不一致。

**`src/pages/ExplorePage.tsx`**:每日推荐 `HeroCard` 目前标题写死 `"每日推荐"`、带日期徽标 `<span>{new Date().getDate()}</span>`。改为按 `dailySongs[0]?.source === 'qq'` 分支:
- QQ:标题 `"猜你喜欢"`,不渲染日期徽标(`badge` 传 `undefined`),副标题沿用现有 `${dailySongs.length} 首 · 根据你的口味` 模式(与雷达卡片副标题措辞对齐,不用"每天更新")。
- netease:保持现状不变。

雷达卡片(`title="私人雷达"`)两音源共用同一份 JSX,不需要改。

### 数据流

```
ExplorePage
  → service.getRecommendPlaylists(page)  → QQMusicService → GET /api/qq/recommend/playlists → handleQQRecommendFeed → GetRecommendFeed
  → service.getDailySongs()              → QQMusicService → GET /api/qq/recommend/songs      → handleQQRecommendSongs → get_radio_track ×N
  → service.getRadarPlaylist()           → QQMusicService → GET /api/qq/radar                → handleQQRadarSong      → GetRadarSong
```

三者与网易云侧完全并列走 `useMusicService()`(按 `activeSource` 返回单例),ExplorePage 已有的 `loadSession` 竞态守卫、`stack-pool.ts` 的 `refill`/`needsRefill` 去重逻辑无需改动,直接复用。

## 错误处理

- 所有新 handler 对"未登录"和"上游返回空/异常结构"两种情况都返回空结构(`[]`/`null`)而不抛错,前端按现有空状态渲染(Stack 不显示、卡片不渲染、`poolLoaded && hand.length===0` 时走"暂时没有推荐内容"文案),不引入新的错误 UI。
- 路由层 try/catch 兜底 500 + `console.error`,与现有 QQ 路由一致,前端 `api.get` 出错时上层 `.catch(() => {})` 已兜底(参照 `ExplorePage.tsx` 现有 `getRecommendPlaylists`/`getDailySongs`/`getRadarPlaylist` 的调用点,均已有 `.catch`)。

## 测试 / 验证

- `npm run typecheck`:两套 tsconfig 全量检查,确认新增字段/接口类型对齐 `MusicService`/`RadarPlaylist`。
- `npm test`:跑现有 vitest 套件(不新增单测,三个 handler 依赖真实网络上游,当前项目对 QQ/网易 client 也没有做上游 mock 单测的先例,遵循现状)。
- **人工验证(必须,交给持有真实 QQ 登录 cookie 的人执行)**:
  1. `npm run dev` 启动,QQ 音源登录后进入探索页。
  2. Stack 池子:确认展示的是官方推荐歌单(非用户自己的歌单),下拉见底触发翻页后拿到新内容(而非重复项/空转)。
  3. "猜你喜欢"卡片:标题正确、数量在 15~20 首左右、点开能正常播放。
  4. "私人雷达"卡片:标题"私人雷达"、曲目可播放。
  5. 退出登录后回到探索页:三块内容按未登录态优雅隐藏,不报错、不白屏。
  6. 若某接口字段解析不对(卡片空白但网络有响应),记录该接口实际响应结构反馈,据此修正字段候选列表。

## 收尾

实现完成后同步更新 `docs/qq-music-api.md`:
- 第 1 节"已有路由"表格追加 `radar`/`recommend/playlists`/`recommend/songs` 三行,状态标"已用"。
- 第 3 节"建议接入顺序"一段标注已完成,或直接删除(该建议已被执行)。
