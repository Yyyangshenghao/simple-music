# 构建、打包与发布/更新流程

## 0. 版本升级规范（默认发布协议）

### 0.1 “推送”的默认含义

在 Simple Music 仓库中，用户说“推送”“提交并推送”或“可以发了”，默认表示执行一次完整版本升级，而不是只运行 `git push`。完整版本升级必须完成：

1. 确定目标版本、对应 `dev/X.Y.Z` 及完整发布范围；
2. 将该版本的 feature PR 验收后合入 dev，不混入其他版本的工作；
3. 在 dev 更新版本文件、发行说明，创建独立发布元数据提交；
4. 完成逻辑复核、自动化验证和必要的 UI 冒烟；
5. 创建 dev → master 的发布 PR，经评审和检查后使用 Merge commit 合并；
6. 核对合并后的 master 提交，对该提交创建并推送 annotated tag；
7. 等待 GitHub Actions 完成，核对 Release 与安装包，并同步仍在维护的 dev。

用户明确说“只推代码”“只推分支”“推送 feature/dev 分支”“不要升级版本”或“不要打 tag”时，只同步指定分支，不自动发布。创建 feature、合入 dev、写文档或讨论规范本身也不构成发布请求。

开始执行前告知目标版本、发布范围，以及将合入 master 并创建公开 tag/Release。完整发布请求已授权本流程内的 PR、合并与标签操作，不重复确认；冲突、版本范围不明确或需要额外绕过门禁时应停止说明。

正常发布路径固定为 `feature/*` → `dev/X.Y.Z` → `master` → `vX.Y.Z` → Release，分支创建、同步和合并方式以 [协作规范](../CONTRIBUTING.md) 为准。master 只接收已验收的版本；未纳入本次发布的工作留在尚未合入待发布 dev 的 feature，或明确属于其他版本的 dev，不能混入待发布 dev。

### 0.2 版本号规则

版本号使用 `X.Y.Z`：

- `Z`（补丁版）：修复、体验优化、兼容性改进，以及不改变主要产品边界的小功能；
- `Y`（功能版）：一组明显的新能力或阶段性里程碑，旧数据仍可兼容；
- `X`（大版本）：存在破坏性变更、重大架构迁移或需要用户明确感知的数据迁移。

目标版本按以下优先级确定：

1. 用户明确指定的版本；
2. 所属 dev 分支的版本，例如 `dev/2.3.0` 对应 `2.3.0`，feature 必须先确认所属 dev；
3. 两者都没有时，默认将 `package.json` 当前版本递增一个补丁版本。

用户指定版本必须与版本 dev 一致；冲突时先明确正确 dev，不能在现有 dev 上随意改成另一个版本。版本号和正式标签在开发期不能作为“已经发布”的证明。发布准备前 `package.json` 可以仍是上一稳定版版本，版本 dev 名称表示目标；准备发布时统一更新两个版本文件，不因普通 feature 提交反复升级版本。

如果分支版本、用户指定版本和现有 tag 冲突，必须停止并说明，不能猜测或覆盖已有 tag。`package.json` 是应用版本的唯一事实来源，`package-lock.json` 顶层及根包版本必须与其一致。

### 0.3 发布前检查

在版本 dev 上准备发布元数据，并完成：

```bash
git status --short --branch
git log <上一个版本标签>..HEAD --oneline
git tag --list "v<目标版本>"
git ls-remote --tags origin "refs/tags/v<目标版本>"
npm version <目标版本> --no-git-tag-version
npm run typecheck
npm test
npm run build
git diff --check
```

同时检查：

- 工作区没有混入无关改动；只能提交本次版本已确认的文件，发现用户遗留改动或范围不明时停止或使用已确认范围的独立工作区，不擅自迁移改动；
- dev 包含当前 master 的必要更新，待发布 feature 均已集成，发布 PR 范围完整；未验收功能留在独立 feature，不能靠发版时临时删除功能来裁剪范围；
- 新功能、修复和设置迁移形成完整调用链；
- 受影响的 UI 已用 `npm run dev` 冒烟；
- `docs/release-notes-<目标版本>.md` 已创建，至少包含更新日志、兼容说明和验证情况；
- 发行说明开头按下面模板放置四条要点，每行不超过 72 个字符，便于应用内更新弹窗提取；
- 目标版本高于上一稳定发布版本，且本地与远端均不存在同名 tag；dev 已预先更新版本号时，不重复递增。

```markdown
## 更新日志

- 新增：新增的功能。
- 新增：新增的另一项功能。
- 优化：调整的行为或性能。
- 修复：修复的具体问题。

## 兼容说明

- 无破坏性变更；如有迁移要求，在这里明确写出。

## 验证情况

- 类型检查、自动化测试和本次 UI 冒烟结果。
```

发布工作流会把该文件原样作为 GitHub Release body；文件缺失、三个标题及四条摘要格式不正确、`package.json` 与 `package-lock.json` 版本不一致，或 tag 与应用版本不一致时，`validate` job 必须失败，不能发布元数据不完整的版本。

应用内「设置 → 关于应用 → 更新日志」按钮打开独立日志页，复用 `docs/release-notes-*.md`，随渲染层打包，离线可读。每次发布只需按上述模板新增对应版本的发行说明，不另维护一份应用内日志；保留历史文件，按版本倒序展示当前及更早版本的更新日志、兼容说明，开发验收记录不展示。2.0.0 的旧标题「主要变化」继续兼容。发行说明必须在构建前写好；应用版本尚未升级时，不会展示更高版本的草稿。

摘要使用「类别：具体变更」，类别可选「新增」（feat）、「优化」（perf）、「修复」（fix）和「说明」（note），不要求每个版本包含所有类别。客观描述新增、调整或修复的内容，不添加宣传性标题、主观评价或额外阐述；只保留既有行为、发布范围或维护事项的条目用「说明」，不要当作新增功能。应用内按类别分组、显示数量。旧的带标题或无标记摘要仍可读取：以新增/支持/补齐、优化/完善、修复开头的条目对应归类，其余保留为说明；也支持 `feat:` / `fix:` / `perf:` / `note:` 标记。四条摘要与每行 72 字符的发布要求不变。

验证失败时可以保留或推送开发提交供修复，但不得合入 master、创建正式 tag 或公开 Release。文档、代码和工作流未同步完成时，不把目标门禁当作已经通过。

### 0.4 提交、合并、标签和推送顺序

功能改动与发布元数据分成两个边界：feature → dev 的 Squash 提交保持原有 Conventional Commit；版本号和发行说明在 dev 上使用单独发布提交。以下以 2.3.0 为例；版本号必须替换为实际目标。

```bash
# 在 dev/2.3.0 上检查暂存范围后提交发布元数据
git add package.json package-lock.json docs/release-notes-2.3.0.md
git diff --cached --check
git diff --cached --stat
git commit -m "chore(release): 发布 v2.3.0"
git push -u origin dev/2.3.0
```

随后创建 `dev/2.3.0` → `master` 的发布 PR，标题为 `chore(release): 发布 v2.3.0`。审核版本范围、验证结果和发行说明后，使用 **Merge commit** 合并；不得先在 dev 打正式标签，也不对整条 dev 使用 Squash/rebase merge。

从 PR 返回结果取得合并后的 master 提交 SHA，核对该 SHA 上的版本、lockfile、发行说明和检查结果。不要假定本地 dev 的 HEAD、PR 合并前的 SHA 或此刻最新 master 恰好等于该发布提交。

```bash
git fetch origin master --tags
# 将下值替换为该发布 PR 合并后的 master 提交 SHA
release_commit='填写已核对的发布合并提交SHA'
git show "${release_commit}:package.json"
git show "${release_commit}:package-lock.json"
git show "${release_commit}:docs/release-notes-2.3.0.md"
# 再次确认本地、远端无 v2.3.0，并核对上述三个文件
git tag --list v2.3.0
git ls-remote --tags origin refs/tags/v2.3.0
# 来源检查失败时不创建标签；创建失败时不推送，任一步失败都应停止
git merge-base --is-ancestor "$release_commit" origin/master &&
  git tag -a v2.3.0 "$release_commit" -m "Simple Music v2.3.0" &&
  git push origin v2.3.0
```

tag 必须指向发布 PR 合并后的 master 提交，包含 dev 中的独立发布元数据提交。发布工作流构建该 tag 的固定源码；**不能将 checkout 改成随时间移动的 master**。master 后续变化不得改变已经发布的同名版本。

### 0.5 推送后的发布验收

推送标签后不能立即结束任务，必须跟踪 GitHub Actions 到最终状态，并确认 GitHub Release 至少包含：

- macOS Intel 与 Apple Silicon 的 `.dmg`；
- Windows 安装版 `-Setup.exe` 与便携版 `-portable.exe`；
- `latest*.yml` 和对应 blockmap（供应用内更新与完整性校验使用）。

工作流会在公开 Release 前自动检查这些必需产物；自动检查通过后仍需人工核对 Release 页面和文件名。

最后报告目标版本、发布提交、tag、CI 状态、Release 链接和真实剩余风险。若 CI 只是临时基础设施故障，可重跑原工作流；如果是源码或打包问题，修复后发布下一个补丁版本，不移动或覆盖已经推送的 tag。

### 0.6 失败与回滚原则

- 发布前失败：保留改动，修复后重新验证，不创建 tag；
- 标签已推送但构建失败：先判断能否安全重跑；禁止静默强推或重写 tag；
- Release 已发布但应用存在严重问题：优先发布更高补丁版本；若需要撤下当前版本，必须由用户明确授权后再调整 GitHub Release 状态；
- 任何时候都不自动删除远端分支、tag、Release 或安装包。

### 0.7 CI 与发布门禁

以下是本仓库的目标验收标准，自动化配置必须与其同步：

| 入口 | 必须完成的检查 | 是否允许发布稳定版 |
|---|---|---|
| feature PR → 所属 dev | 类型检查、全量测试、源码构建；受影响的 UI/播放/登录流程人工检查 | 否 |
| dev 更新、dev PR → master | Windows/macOS 类型检查、全量测试、源码构建及版本范围复核；发布 PR 额外检查版本文件和发行说明 | 否 |
| master 更新 | 对合并后的提交执行 Windows/macOS 类型检查、全量测试和源码构建 | 否；通过后才能为该发布提交打 tag |
| 正式版本 tag | 校验来源为已验收 master 提交、版本和说明一致；双平台测试、正式签名、打包、产物齐全检查，统一发布 | 是 |

- PR 和普通分支 CI 使用只读仓库权限，不使用生产签名凭据、不创建 Release。明确需要预发布时单独使用预发布版本和渠道，不能伪装成稳定版。
- master 和活跃 dev 应启用 PR 合并及必需状态检查；master 发布 PR 还要求至少 1 人评审通过。不得以管理员绕过失败检查完成正常发布。
- tag 需要限制创建、更新和删除权限；稳定发布校验必须检查提交来源，不能仅凭 `v*.*.*` 名称判断可发布。
- Release 默认只读权限，仅发布 job 授予 `contents: write`；生产签名凭据只提供给受信任的正式打包步骤。同一版本发布避免并发执行，失败时保留固定 tag。
- **截至 2026-10-02，现有 `.github/workflows/release.yml` 已实现 tag 触发、元数据校验、双平台测试/打包及产物检查；PR/dev/master CI、来源校验和分支/tag 门禁尚未配置，Release 仍使用工作流级写权限且没有并发限制。未落地的流程检查目前由人工执行；权限、并发与平台门禁需后续配置，不能声称已由 GitHub 自动强制。配置落地时同步更新本段。**

### 0.8 紧急补丁与旧版本维护

- 默认补丁仍遵循正常流程：从最新 master 创建目标补丁 dev，从 dev 创建修复 feature，依次合入 dev、master，验证 master 提交后打 tag；再将 master 的修复同步到仍在维护的新版本 dev。
- master 原则上不提前集成下一版本的未验收功能。已有历史分支和已发布版本不因本规范回退、重命名或重打标签。
- 若用户明确要求基于旧稳定版修复并排除 master 中已有功能，先说明基准 tag、维护版本、排除范围及绕过常规主干来源规则的原因；只有得到明确的旧版本维护授权后才能采用独立维护分支。不能把普通 feature/dev 发布解释为此例外。
- 维护发布仍须完成测试、签名、发行说明与产物验收，记录真实源码提交，并将修复单独回灌 master 及相关 dev。不得为证明“已合主干”而移动旧 tag，也不能把现有 master 额外功能混入旧版补丁。自动来源门禁落地后，此例外也需显式配置授权路径，不能临时关闭门禁。

## 1. 常用命令

```bash
npm run dev            # electron-vite 开发模式：渲染层 vite dev server(5173)，主进程+preload 热重建
npm run build          # electron-vite build → out/{main,preload,renderer}
npm run typecheck      # 两套 tsconfig 全量：node 侧(electron/+server/) + 渲染侧(src/+overlays/)
npm test               # vitest run（测试与源码同目录）
npx vitest run src/lib/stack-pool.test.ts   # 单测单文件
npm run server:dev     # 只跑 API server（tsx server/index.ts），默认端口 35530，可 PORT= 覆盖
npm run build:mac      # build + electron-builder --mac（dmg，x64 + arm64）
npm run build:win      # build + electron-builder --win（NSIS Setup + portable，均 x64）
```

## 2. electron-vite 三段构建

`electron.vite.config.ts`：

- **main**：入口 `electron/main.ts` → `out/main/index.js`（package.json `main` 指向它）。`externalizeDepsPlugin` 把 node_modules 依赖保持 external（打包时由 electron-builder 收进 asar）。
- **preload**：两个入口 `index`（主窗口）+ `overlay`（悬浮窗）→ `out/preload/{index,overlay}.cjs`。全部 BrowserWindow 开启 `sandbox: true`，所以 preload 强制输出 CommonJS；主进程引用对应 `.cjs` 文件。
- **renderer**：`root: '.'`，**多页构建**——`index.html`（主窗口）及 desktop-lyrics、wallpaper、mini-player 三个 overlay HTML，共四个入口共享 `src/` 代码；别名 `@renderer` → `src`。

dev/prod 的 URL 解析在 `window-manager.ts#resolveRendererUrl`：dev 用环境变量 `ELECTRON_RENDERER_URL` 拼相对入口，prod 用 `file://out/renderer/<entry>`。**新增悬浮窗页面必须同时加 renderer.input**，否则 prod 下 404。

## 3. electron-builder 打包

配置内联在 package.json `build` 字段：

- `appId: com.simplemusic.desktop`，产物输出 `dist/`，资源目录 `build/`（icon.ico/icon.icns）。
- `files`: `out/**/*` + `build/icon.ico` + `package.json`（**package.json 必须进 asar**——server/lib/update.ts 运行时 `import pkgJson from '../../package.json'` 读版本与更新配置）。
- **mac**：dmg，x64 + arm64 双架构分别出包；`identity: null` 即**不签名**——这决定了更新安装方案（见 §5）。分发文件名 `Simple-Music-<v>-arm64.dmg` / `Simple-Music-<v>-x64.dmg`。
- **win**：NSIS（`Simple-Music-<v>-Setup.exe`，非 oneClick、建快捷方式）+ portable（`Simple-Music-<v>-portable.exe`，不参与自动更新）。`allowToChangeInstallationDirectory: false` 关闭 electron-builder 自带目录页，`build/installer.nsh` 再提供品牌化的单个自定义目录页，避免重复并保留自由选盘/路径与 `/D=` 支持。
- 安装包名称显式使用连字符，避免 GitHub 上传时替换空格，导致 `latest*.yml` 中的文件名与 Release 资源不一致。
- **Apple Music DRM**：桌面运行时使用 CastLabs ECS。发布流水线固定 Node 22.12，并在 macOS 的 `afterPack`（系统代码签名前）和 Windows 的 `afterSign`（系统代码签名后）调用 EVS，生成 streaming VMP 生产签名。CI 缺少 `EVS_ACCOUNT_NAME` 或 `EVS_PASSWD` 时必须中止，禁止发布只能使用开发 DRM 签名的安装包；本地普通打包默认跳过，设置 `VMP_SIGN=1` 可强制执行。

## 4. 发布约定

- GitHub Releases（仓库 `Yyyangshenghao/simple-music`），tag 形如 `v1.3.0`。
- Release 资源命名必须匹配更新器的挑选正则（`server/lib/update.ts#pickReleaseAsset`）：
  - mac：优先 `<arch>.*\.dmg`，回退任意 `.dmg`；
  - win：优先 `-Setup.exe`，其次非 portable 的 `.exe`、`.msi`；
  - **找不到匹配当前平台的资源返回 null → 前端收到 `UPDATE_ASSET_MISSING`**，不会错发别的平台安装包（曾有给 mac 用户发 portable.exe 的教训，pickReleaseAsset 的平台过滤即为此而生）。
- Release body 前几行会被 `extractReleaseNotes` 提取为更新弹窗要点（每行 ≤72 字符、最多 4 条、跳过链接和 "What's Changed" 标题）。
- electron-builder 生成的 `latest.yml` 与 `latest-mac.yml` 必须一并上传：GitHub API 被限流/失败时按平台读取对应备用清单；macOS 从清单中选择当前架构的 dmg，并使用该文件自身的摘要和大小，没有匹配资源时不返回其他平台安装包。

## 5. 半自动更新全链路

设计文档：`docs/superpowers/plans/2026-07-12-semi-auto-update.md`。"半自动" = 检查/下载全自动，安装需用户点一下。

```
渲染层 update store（App 启动即 checkForUpdate）
  → GET /api/update/latest
      server: manifest 覆盖(env) → GitHub API /releases/latest → 失败退对应平台的 latest.yml / latest-mac.yml → 再失败本地回退(不报可用更新)
  → UpdateBanner / 设置页显示「发现新版本」
  → POST /api/update/download        # 创建下载任务(有同版本活跃任务则复用;本地已有校验通过的缓存包直接 ready)
  → 轮询 GET /api/update/download/status?id=   # 800ms，进度/速度/ETA/当前线路/失败原因
      server: 候选线路 = 镜像×资源URL + GitHub 直连(preferMirrors 决定顺序)，逐线路重试;
              镜像线路必须有 sha256/sha512 digest 才允许(防镜像缓存投毒);
              下载完成后 size + sha256 + sha512 三重校验，.download 临时文件 rename 落位 userData/updates/downloads/
  → job.status === 'ready' → 用户点「重启并安装」
  → window.desktop.installUpdate(filePath) → IPC app:install-update
      主进程校验 filePath 必须位于 userData/updates/ 内 →
      · Windows: spawn NSIS 安装包 /S --force-run（与 electron-updater 参数一致，按注册表原地升级）→ app.quit()
      · macOS:   shell.openPath(dmg) 交给 Finder 挂载并显示标准安装窗口 → app.quit()
                 用户手动把新版本拖到 Applications 并确认替换；主进程不再原地改写 .app
```

补充细节：

- 更新安装成功与应用重启复用 `before-quit` 清理悬浮窗和 Apple 播放会话；清理卡住时保留 8 秒强制退出兜底。
- **补丁热更新（/api/update/patch）在新架构不支持**：原项目"源码即运行文件"，补丁按文件名写回；本项目源码经打包后与产物不对应。端点与任务队列结构保留，但应用补丁一步显式抛 `PATCH_NOT_SUPPORTED`（不静默成功、不写文件、不换线路重试）。
- **macOS 不做原地静默替换**：应用未签名，旧版 hdiutil + shell 脚本方案在权限或进程中断时可能留下孤儿目录，现只打开已校验 dmg，替换动作交给 Finder 和用户。
- 下载错误分类（`classifyUpdateError`）：hash/size 不符、超时、DNS、网络中断、HTTP 403/404/5xx 均映射为中文原因给 UI；失败线路记录在 `failedAttempts`（最多 6 条）。
- 任务表 `updateDownloadJobs` 是内存 Map，保留最近 8 个任务。
- `electron/ipc/misc.ts` 的更新目录**不读** `SIMPLEMUSIC_UPDATE_DIR` 等 env（server 侧读）：手动覆盖下载目录调试时，install 会稳定返回 `INVALID_UPDATE_PATH`，属已知不对齐（源码注释有说明）。

## 6. 环境变量（构建/更新相关）

| 变量 | 作用 |
|---|---|
| `ELECTRON_RENDERER_URL` | electron-vite dev 自动注入，主进程据此加载 vite dev server |
| `PORT` | `server:dev` 独立运行时的监听端口（默认 35530） |
| `SIMPLEMUSIC_VERSION` | 覆盖上报版本（更新调试用） |
| `SIMPLEMUSIC_UPDATE_REPOSITORY` / `_OWNER` / `_REPO` | 覆盖更新仓库 |
| `SIMPLEMUSIC_UPDATE_MIRRORS`（或 `_MIRROR`） | 覆盖镜像列表（逗号/分号/换行分隔） |
| `SIMPLEMUSIC_UPDATE_MANIFEST`（`_URL`/`_FILE`） | 指向自托管更新 manifest（http(s)/file/本地路径），设置后跳过 GitHub 检查 |
| `SIMPLEMUSIC_UPDATE_DIR` / `SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR` | 覆盖更新工作/下载目录（注意 §5 的 install 校验不对齐） |
| `SIMPLEMUSIC_BEAT_CACHE_DIR` | 覆盖节拍图缓存目录（默认 userData/beatmaps） |
| `SIMPLEMUSIC_NO_DESKTOP_SHORTCUT` / `SIMPLEMUSIC_CREATE_DESKTOP_SHORTCUT` | win32 桌面快捷方式开关（未打包默认不建） |
| `EVS_ACCOUNT_NAME` / `EVS_PASSWD` | CastLabs EVS 生产 VMP 签名账号；发布 CI 必填并保存为同名 GitHub Actions secrets |
| `VMP_SIGN` | 本地设为 `1` 时强制运行 EVS VMP 签名；CI 始终要求签名凭据 |
