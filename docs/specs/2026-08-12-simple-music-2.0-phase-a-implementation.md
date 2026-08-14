# Simple Music 2.0 阶段 A 实施计划

> 状态：已完成，待提交
>
> 对应设计：[Simple Music 2.0 多平台融合架构设计](./2026-08-12-simple-music-2.0-multi-provider-design.md)
>
> 目标里程碑：`2.0.0-alpha.1`

## 目标

在不改变 1.x 页面和播放行为的前提下，建立 2.0 的 provider 地基：

- 网易云和 QQ 由统一注册表创建并暴露分层能力。
- 新增多音源启用状态、播放顺序、原来源优先和跨源降级设置。
- 首次启动从 1.x `activeSource/crossSourceFallback` 迁移并保留旧设置备份。
- 旧页面继续通过 `MusicService` 兼容层运行，阶段 B 再逐页迁移。

## 范围

### 本阶段实现

- `src/providers/`：provider 类型、旧服务适配器、网易云/QQ 声明、注册表。
- `src/lib/provider-preferences.ts`：持久化 schema、归一化和 1.x 迁移纯函数。
- `src/stores/providers.ts`：运行时 provider 状态和兼容同步。
- `src/lib/service-registry.ts`：改为复用 provider 注册表中的旧服务单例。
- `src/App.tsx`：在旧 settings 加载后初始化 provider store。
- 契约、迁移和 store 测试。

### 本阶段不实现

- 不移除 `activeSource` 或 `useMusicService()`。
- 不改首页、搜索、我的库、漫游和刷歌的单音源展示。
- 不替换现有播放器和二元跨源兜底。
- 不修改包版本，不发布 alpha 安装包。
- 不接入第三个真实线上音源。

## 兼容边界

1. provider 注册表持有网易云和 QQ 的唯一 `MusicService` 单例；旧 `service-registry.ts` 只重新导出这些单例。
2. 迁移期旧设置仍可写：`activeSource` 改变时只调整新 `playbackOrder` 的首位，`crossSourceFallback` 同步到 `multiSourceFallback`。
3. 新 provider 状态不反向改变旧 UI；阶段 B 移除音源切换界面后再删除兼容同步。
4. provider 持久化使用独立 key 和 schema，损坏时只重置 provider 域。
5. 旧 `simplemusic-settings` 在首次迁移时原文备份，不覆盖用户设置。

## 执行顺序

1. 冻结 provider ID、能力协议和推荐栏目协议。
2. 用适配器包装现有 `NeteaseMusicService`、`QQMusicService`，注册为唯一实例。
3. 实现 provider settings schema、顺序归一化和四种旧设置组合迁移。
4. 实现 provider store；应用启动时水合，并订阅旧设置作为临时兼容输入。
5. 补测试并运行类型检查、全量测试。
6. 独立复审，确认没有页面行为变化和双服务实例。

## 验证

- provider 注册表只包含唯一的 `netease`、`qq`，描述和能力声明完整。
- `serviceFor('netease' | 'qq')` 与 provider 的 `legacyService` 是同一实例。
- `activeSource × crossSourceFallback` 四种组合迁移结果正确且重复读取幂等。
- 启用/停用音源后 `playbackOrder` 只包含全部已启用音源且不重复。
- 旧设置变化能同步新 store，停止初始化订阅后不再同步。
- `npm run typecheck`、`npm test` 通过。

实施结果（2026-08-12）：类型检查通过，全量 40 个测试文件、330 个测试通过；独立复审未发现阻断项。阶段 B 开始消费 capability 前，provider 适配器的目录、播放、歌词和推荐分页行为已有统一契约测试保护。

## 回滚

- 本阶段不删除旧状态和旧接口；回滚时移除 `App` 的 provider 初始化，并让 `service-registry.ts` 恢复直接创建两个 service。
- 新 provider localStorage key 可被旧版本忽略。
- `simplemusic-settings-v1-backup` 保留旧设置原文，迁移失败不影响 1.x 启动。
