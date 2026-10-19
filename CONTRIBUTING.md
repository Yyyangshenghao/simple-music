# 协作规范

Simple Music 的多人协作约定：分支怎么开、代码怎么提、消息怎么写、版本怎么发。架构与模块入口见 [文档导航](docs/README.md)，仓库代理的改动边界见 [AGENTS.md](AGENTS.md)。

## 一、分支模型

- 默认贡献流程：**`feature/*` → `dev/X.Y.Z` → `master` → `vX.Y.Z` → Release**。
- **`master` 是正式发布主干**，只接收完成版本验收的 dev 发布 PR，保持可发布状态。禁止直接提交或推送业务改动到 master；正式版本必须先合入 master，再从合并后的提交打标签构建。
- **`dev/X.Y.Z` 是该版本唯一的集成分支**，例如 `dev/2.3.0`。版本启动时从最新 `origin/master` 创建，集中集成该版本功能、修复、版本文件和发行说明；允许构建、测试及明确标识的预发布，不直接发布稳定版。
- **`feature/<简短描述>` 是单项工作分支**，从所属版本的最新 dev 创建。贡献者在 feature 开发并提交 PR 到所属 dev，由仓库所有者评审后合并；默认不得直接提交、合并或推送到共享 dev，也不得跳过 dev 直接合入 master。
- 默认只有一个正在开发的 dev；并行维护其他版本时必须明确各自范围，不能按分支名猜测发布内容。发布后的 dev 不继续承载下一版本，下一版本另建 dev。

### 仓库所有者的本地维护流程

本节的所有者与共享 dev/master 均指 Simple Music 上游仓库；fork 的所有权或写权限不代表上游维护权限。

仓库所有者本人维护时，可以直接在所属 dev 修改，也可以从最新 dev 创建本地 feature，完成验证后直接合回 dev，无需开发 PR，不强制每项任务另开分支或 worktree。

代理只有在仓库所有者明确授权采用此维护流程时，才可在授权范围内执行；授权范围以所有者的会话指示或私有配置为准。本文件本身不授予该权限，普通开发请求、fork 的所有权、分支名称或使用代理工具均不能作为授权依据。未获得此授权时一律使用默认贡献流程，不自行把自己归入所有者或授权代理。

维护流程仍须完成同样的验证与适用的独立复核，遵守实际远端权限和分支保护；它不包含直接修改 master、打 tag 或发布 Release 的授权。

### 分支命名与职责

| 分支 | 用途 | 示例 |
|------|------|------|
| `master` | 已验收版本及正式发布基准 | `master` |
| `dev/X.Y.Z` | 一个目标版本的集成与验收 | `dev/2.3.0` |
| `feature/<简短描述>` | 该版本中的单项改动 | `feature/queue-controls`、`feature/apple-icon-fix` |

描述使用小写英文或拼音短横线连接。一个 feature 只做一件事；无关工作单独处理。已有 `feat/*`、`fix/*`、`codex/*` 等分支不自动重命名，先确认所属 dev，再按本流程集成；新建工作分支统一使用上述命名。

### 同步与隔离

- 创建、切换或合并分支前检查工作区；未提交改动不自动 stash、移动、提交或覆盖。需要并行工作时使用独立 worktree，先核对目标 dev 和已有工作区，防止跨版本混入。
- feature 跟随所属 dev 同步。未共享的 feature 可 rebase；已共享分支的历史改写必须得到授权。dev 和 master 使用 merge 同步，禁止 rebase 或强推已共享的集成、发布历史。
- 正式版本发布后，将最新 master 合入仍在维护的 dev，再继续开发。远端分支清理需确认没有未合入工作，不自动删除。

## 二、Commit Message 规范

采用 Conventional Commits 变体:**type 用英文,主题用中文**,与仓库现有历史保持一致。

### 格式

```
<type>: <一句话中文描述做了什么>

<正文(可选):为什么改、根因是什么、方案取舍。
陈述动机与结论,不要罗列文件清单。>
```

### type 取值

`feat` 新功能 / `fix` 修 bug / `perf` 性能 / `refactor` 重构 / `docs` 文档 / `test` 补测试 / `chore` 构建、依赖、CI / `style` 纯样式格式(不改逻辑) / `license` 许可证。

### 规则

- 主题一句话说清"做了什么",不超过 50 个字,结尾不加句号。
- 修 bug 的提交,正文写**根因**而不是现象(参考 `cf24abd` 的写法:先说为什么漏,再说怎么修)。
- 功能/修复提交不在主题末尾拼版本号；版本号与发行说明由独立的 `chore(release): 发布 vX.Y.Z` 提交承载。
- 一次提交一个逻辑单元:修复与重构分开提,不要"顺带"改无关代码。
- 提交前必须本地通过:`npm run typecheck && npm test`。

### 好与坏的例子

```
✅ fix: 修复切歌时旧封面采样晚到覆盖新封面的竞态
✅ feat: 探索页新增私人雷达卡片
❌ fix: 修改了一些问题            (说不清做了什么)
❌ update code                    (无 type、无信息量)
❌ feat: 加歌词功能并修了播放bug并升级依赖  (混了三件事)
```

## 三、阶段集成与发布 PR

1. **开工前**：确认目标版本和验收范围，从所属 dev 创建 feature；版本 dev 尚不存在时由所有者从最新 master 创建。使用所有者本地维护流程时，按第一节的授权范围选择直接在 dev 修改或使用本地 feature/worktree。
2. **开发中**：只修改任务相关文件，在 feature 保留进行中的提交。获准直接在 dev 开发时，完成阶段验证后再提交，不叠加或推送未验收工作；需要并行隔离时使用独立 feature/worktree。
3. **集成前自查**:
   - `npm run typecheck && npm test` 全绿(仓库无 lint,这两项就是验收线);
   - 涉及 UI 的改动,本地 `npm run dev` 实际跑一遍受影响的页面;
   - 自己先读一遍 diff,删掉调试代码与无关改动。
4. **阶段记录**写明范围、原因、验证、所属版本和目标分支；UI 变更保留截图或录屏。发布 PR 目标为 master，描述必须列出完整版本范围、版本文件和发行说明。
5. **评审与门禁**：阶段集成完成必要检查，涉及行为的中高风险改动须独立复核，意见逐条处理。贡献 PR 须由所有者评审并通过检查；仅第一节的本地维护流程免开发 PR。发布 PR 仍须至少 1 人 approve，自动检查通过；不能因为尚未配置 GitHub 门禁而跳过验收。
6. **开发成果进入 dev**：默认通过 feature → dev PR，评审后 **Squash merge**。仅在所有者本地维护流程内，可以在 dev 验收后直接提交，或将本地 feature 以 Squash merge 合回 dev。提交标题按第二节规范写；合并前确认双方工作区干净、目标 dev 最新，合并后核对范围。dev 推送仍触发双平台 CI，失败时先修复，不进入发布流程。
7. **dev → master**：使用 **Merge commit**，保留功能提交及独立发布元数据提交，使 dev 与 master 保持共同历史；发布 PR 标题为 `chore(release): 发布 vX.Y.Z`。不得对整条 dev 使用 Squash merge 或 rebase merge。
8. **合并后**：核对实际合并提交及文件范围。只有 master 合并后的发布提交允许创建正式版本 tag，具体步骤见 [构建与发布 §0](docs/build-and-release.md)。

默认贡献任务交付 feature 与 PR，不自动向共享 dev 提交。仅在已获授权的所有者本地维护任务中，阶段完成必要检查与适用的独立复核后，主动在目标 dev 提交或将本地 feature 合回，无需重复请求已获授权的阶段集成确认；主工作区保持在 dev 供所有者测试，后续按改动规模与并行需要选择直接开发或独立 feature/worktree。阶段集成不等同于版本发布，不自动升级版本、合入 master 或创建 tag/Release。

## 四、代码约定(易踩坑必读)

完整清单见 [CLAUDE.md](CLAUDE.md),评审时重点盯这些历史踩过的坑:

- `Track.duration` 全项目**毫秒**;`Track.id` 类型是 `unknown`,比较/拼 URL 前先 `String()`。
- 跨音源实体按自身 `source` 取能力：新代码优先 `providerFor(数据.source)`，兼容层使用 `serviceFor(数据.source)`，不能从当前内容平台猜来源。`ProviderId` 含网易、QQ、Apple；`MusicSource` 另含 `local`。
- Apple Music 的受保护播放不走直链音频代理、跨源兜底或离线缓存；歌词同曲补位与音频来源分开处理。
- 异步 setter 要有竞态守卫(参考 ExplorePage 的 `loadSession` 计数模式)。
- 样式用 CSS Modules + `tokens.css` 变量;动效引用 `motion-presets.ts`,不写魔法数值。
- 全屏 WebGL 场景同屏只跑一个;three.js 对象换用不换卸时记得 `dispose()`。
- 模块级缓存必须有上限(LRU 或定长),历史上曾因无界缓存导致内存持续增长。

## 五、测试

- 纯逻辑(lib/stores/server lib)改动**必须**带单测,测试文件与源码同目录(`*.test.ts`)。
- 修 bug 先写能复现的失败用例,再修到绿(防回归)。
- 跑单个文件:`npx vitest run src/lib/xxx.test.ts`。

## 六、版本与发布

版本号遵循 SemVer。完整流程见 [构建、打包与发布/更新流程](docs/build-and-release.md),其规则优先于本节摘要。

版本元数据在对应 dev 上形成独立提交 `chore(release): 发布 vX.Y.Z`。dev 的发布 PR 验收后合入 master，annotated tag `vX.Y.Z` 指向该 PR 合并后的 master 提交，不能提前打在 feature 或 dev 上。正式安装包构建该 tag 的固定源码，不跟随之后移动的 master。

PR、dev 和 master 的 CI 验收目标与当前落地状态见 [构建与发布 §0.7](docs/build-and-release.md#07-ci-与发布门禁)。推送 tag 后等待 Release 工作流完成并核对所有产物；已推送 tag 不可移动或覆盖。紧急补丁也默认遵循 dev → master → tag，旧版本维护例外见 §0.8。

## 七、Issue 约定

- Bug 报告写清:复现步骤、期望行为、实际行为、平台(mac/win)与版本号;能贴日志/截图更好。
- 功能建议先描述**场景和问题**,再谈方案,方便讨论取舍。
