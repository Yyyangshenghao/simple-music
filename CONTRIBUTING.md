# 协作规范

Simple Music 的多人协作约定:分支怎么开、代码怎么提、消息怎么写、版本怎么发。所有规则以本文档为准,架构与代码约定见 [CLAUDE.md](CLAUDE.md) 与 [docs/modules/](docs/modules/)。

## 一、分支模型

- **`master` 是主干,始终保持可发布状态**。禁止直接向 master 推送提交(仓库管理员发版除外),所有改动一律走分支 + Pull Request。
- 所有工作分支**从最新的 master 切出**,合并回 master 后即删除,不留长期分支。

### 分支命名

```
<类型>/<简短描述>          # 描述用小写英文/拼音短横线连接
```

| 类型 | 用途 | 示例 |
|------|------|------|
| `feat/` | 新功能 | `feat/desktop-lyrics-font` |
| `fix/` | 修 bug | `fix/qq-search-empty` |
| `perf/` | 性能优化 | `perf/playlist-cache-lru` |
| `refactor/` | 重构(不改行为) | `refactor/split-player-store` |
| `docs/` | 文档 | `docs/contributing` |
| `chore/` | 构建/依赖/CI | `chore/bump-electron` |

一个分支只做一件事。改到一半发现另一个 bug,另开分支修,不要顺手混进来。

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
- **发版提交**主题末尾带版本号:`fix: 修复三处内存无界增长，v1.1.0`(仅发版那一笔,普通提交不带)。
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

## 三、Pull Request 流程

1. **开工前**:确认 Issue / 需求已明确;从最新 master 切分支。
2. **开发中**:小步提交;与 master 脱节太久时用 `git rebase master` 同步(工作分支上优先 rebase,保持线性历史;**不要 rebase 已合入 master 的提交**)。
3. **提 PR 前自查**:
   - `npm run typecheck && npm test` 全绿(仓库无 lint,这两项就是验收线);
   - 涉及 UI 的改动,本地 `npm run dev` 实际跑一遍受影响的页面;
   - 自己先读一遍 diff,删掉调试代码与无关改动。
4. **PR 描述**写三点:改了什么、为什么改、怎么验证的(测试/实测截图)。UI 改动附截图或录屏。
5. **评审**:至少 1 人 approve 才可合并;评审关注正确性 > 约定一致性 > 风格。作者对每条评论要么改、要么回复理由,不要默默 resolve。
6. **合并**:用 **Squash merge**(PR 内的过程提交压成一笔,标题按第二节规范写),合并后删分支。

## 四、代码约定(易踩坑必读)

完整清单见 [CLAUDE.md](CLAUDE.md),评审时重点盯这些历史踩过的坑:

- `Track.duration` 全项目**毫秒**;`Track.id` 类型是 `unknown`,比较/拼 URL 前先 `String()`。
- 跨音源数据取 service 必须 `serviceFor(数据.source)`,不能用全局 `useMusicService()`。
- 异步 setter 要有竞态守卫(参考 ExplorePage 的 `loadSession` 计数模式)。
- 样式用 CSS Modules + `tokens.css` 变量;动效引用 `motion-presets.ts`,不写魔法数值。
- 全屏 WebGL 场景同屏只跑一个;three.js 对象换用不换卸时记得 `dispose()`。
- 模块级缓存必须有上限(LRU 或定长),历史上曾因无界缓存导致内存持续增长。

## 五、测试

- 纯逻辑(lib/stores/server lib)改动**必须**带单测,测试文件与源码同目录(`*.test.ts`)。
- 修 bug 先写能复现的失败用例,再修到绿(防回归)。
- 跑单个文件:`npx vitest run src/lib/xxx.test.ts`。

## 六、版本与发布

版本号遵循 SemVer:破坏性改动升 major,新功能升 minor,纯修复升 patch。

发布由仓库管理员在 master 上操作:

```bash
npm version <x.y.z> --no-git-tag-version   # 同步 package.json 与 lock
git commit -am "fix: <本次发布主题>，v<x.y.z>"
git tag v<x.y.z>
git push origin master --tags
```

**推送 `v*.*.*` tag 会自动触发 `.github/workflows/release.yml`**,在 CI 上构建 mac / win 安装包并发布 Release,无需本地打包。tag 一旦推出不可改,发错就发下一个 patch 版本修正。

## 七、Issue 约定

- Bug 报告写清:复现步骤、期望行为、实际行为、平台(mac/win)与版本号;能贴日志/截图更好。
- 功能建议先描述**场景和问题**,再谈方案,方便讨论取舍。
