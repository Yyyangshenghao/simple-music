# 构建、打包与发布/更新流程

## 0. 版本升级规范（默认发布协议）

### 0.1 发布维护任务中“推送”的含义

本节只适用于仓库所有者已授权的发布维护任务；普通贡献任务中的推送仅同步已约定的工作分支，不构成版本升级、合入共享 dev/master、创建 tag 或 Release 的授权。

在上述发布维护上下文中，所有者说“推送”“提交并推送”或“可以发了”，默认表示执行一次完整版本升级，而不是只运行 `git push`。完整版本升级必须完成：

1. 确定目标版本、对应 `dev/X.Y.Z` 及完整发布范围；
2. 验收该版本 dev 中的改动及待合入的 feature，完成集成，不混入其他版本的工作；
3. 在 dev 更新版本文件、发行说明，创建独立发布元数据提交；
4. 完成逻辑复核、自动化验证和必要的 UI 冒烟；
5. 创建 dev → master 的发布 PR，经评审和检查后使用 Merge commit 合并；
6. 核对合并后的 master 提交，从 master 手动触发 Release 工作流（tag 由工作流在全部构建成功后创建）；
7. 等待 GitHub Actions 完成，核对 Release 与安装包，并同步仍在维护的 dev。

所有者明确说“只推代码”“只推分支”“推送 feature/dev 分支”“不要升级版本”或“不要打 tag”时，只同步指定分支，不自动发布。创建 feature、合入 dev、写文档或讨论规范本身也不构成发布请求。

所有者说“打预发版”“发 beta”“出个预发包”时，只按 [§0.7.1](#071-预发版验收真实安装包) 推送 dev 并从该 dev 触发预发版，不升级版本、不写发行说明、不合入 master。预发版同样是公开 Release，“推送”“提交并推送”不隐含发预发版。

开始执行前告知目标版本、发布范围，以及将合入 master 并创建公开 tag/Release。完整发布请求已授权本流程内的 PR、合并与标签操作，不重复确认；冲突、版本范围不明确或需要额外绕过门禁时应停止说明。

正常贡献与发布路径为 `feature/*` → `dev/X.Y.Z` → `master` → Release 工作流（创建 `vX.Y.Z` 与 Release），默认通过 feature → dev PR 集成。所有者本地维护的例外与授权范围以 [协作规范](../CONTRIBUTING.md#仓库所有者的本地维护流程) 为准，不能仅凭本发布文档认定免 PR 权限。master 只接收已验收的版本；未纳入本次发布的工作留在尚未合入待发布 dev 的 feature，或明确属于其他版本的 dev，不能混入待发布 dev。

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
npm run release:check   # 版本文件与发行说明，与发布工作流同一套规则
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
- 已在本地打出安装包，并走过一遍安装流程（见下方「本地打包与安装验证」）；
- `docs/release-notes-<目标版本>.md` 已创建，至少包含更新日志、兼容说明和验证情况；
- 发行说明开头按下面模板放置四条要点，每行不超过 72 个字符，便于应用内更新弹窗提取；需要完整日志时，在四条摘要后用三级标题分组补充详情，各条仍标注新增、优化、修复或说明；
- 目标版本高于上一稳定发布版本，且本地与远端均不存在同名 tag；dev 已预先更新版本号时，不重复递增；
- 对照本次发布范围判断根目录 `README.md` 是否需要同步，需要时随本版本 dev 一起修改，不需要时在发布 PR 中注明「README 无需修改」。README 只描述当前能力，不写版本号或「某版本新增」。以下情况需要同步：新增值得列入「功能」的用户可见能力，或移除、改名已有能力；安装方式、系统要求、下载产物或平台支持变化；使用说明中的入口、术语或行为已不符；截图明显过时；新引入需要在「鸣谢与来源」署名的第三方项目、模型或数据。

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

发布工作流会把该文件原样作为 GitHub Release body；四条摘要从「更新日志」标题读取至首个三级详情标题（没有详情时读取至「兼容说明」）。校验规则在 `scripts/release/check-release.mjs`，本地 `npm run release:check`、发布 PR 的 `release-metadata` 检查和发布工作流的 `prepare` job 共用。文件缺失、三个标题及四条摘要格式不正确，或 `package.json` 与 `package-lock.json` 版本不一致时校验失败，不能发布元数据不完整的版本。

应用内「设置 → 关于应用 → 更新日志」按钮打开独立日志页，复用 `docs/release-notes-*.md`，随渲染层打包，离线可读。每次发布只需按上述模板新增对应版本的发行说明，不另维护一份应用内日志；保留历史文件，按版本倒序展示当前及更早版本的更新日志、分组详情中的各条变化和兼容说明，开发验收记录不展示。2.0.0 的旧标题「主要变化」继续兼容。发行说明必须在构建前写好；应用版本尚未升级时，不会展示更高版本的草稿。

摘要使用「类别：具体变更」，类别可选「新增」（feat）、「优化」（perf）、「修复」（fix）和「说明」（note），不要求每个版本包含所有类别。客观描述新增、调整或修复的内容，不添加宣传性标题、主观评价或额外阐述；只保留既有行为、发布范围或维护事项的条目用「说明」，不要当作新增功能。应用内按类别分组、显示数量。旧的带标题或无标记摘要仍可读取：以新增/支持/补齐、优化/完善、修复开头的条目对应归类，其余保留为说明；也支持 `feat:` / `fix:` / `perf:` / `note:` 标记。四条摘要与每行 72 字符的发布要求不变。

验证失败时可以保留或推送开发提交供修复，但不得合入 master、创建正式 tag 或公开 Release。文档、代码和工作流未同步完成时，不把目标门禁当作已经通过。

#### 本地打包与安装验证

`npm run build` 只验证源码构建，打包配置（`files`、`asarUnpack`、原生模块）出错只有打出安装包才看得到。2.6.0 曾因平台级 `files` 只写排除项、白名单失效，把 `docs/`、`src/` 整个打进 asar，安装包从约 115MB 涨到约 250MB。发布前在本机执行：

```bash
npm run build:mac   # Windows 机器上用 npm run build:win
node scripts/release/check-package.mjs mac   # Windows 上传 win；检查 asar 内容与必需产物，并列出安装包体积
```

- 安装包体积与上一 Release 对比，明显变大时先查明原因；
- asar 除 `out/`、`node_modules/`、`package.json` 和图标外不应有其他内容（`check-package.mjs` 会检查并列出多余项；推送 dev 时 CI 也会用同样步骤试打包并检查）；`app.asar.unpacked` 只含目标平台和架构的原生库；
- 用打出的 dmg/exe 实际安装（覆盖安装上一版），启动后检查播放、歌词、登录状态保留，以及依赖原生模块的功能（koffi、AI K 歌的 onnxruntime）能正常加载；
- 本机无法验证的平台（如 Windows 安装、Intel Mac）优先用预发版（§0.7.1）在实机上验收；仍无法验证的，在发行说明「验证情况」中写明未实机验证。

### 0.4 提交、合并、标签和推送顺序

功能改动与发布元数据分成两个边界：直接在 dev 开发的提交或 feature → dev 的 Squash 提交保持原有 Conventional Commit；版本号和发行说明在 dev 上使用单独发布提交。以下以 2.3.0 为例；版本号必须替换为实际目标。

```bash
# 在 dev/2.3.0 上检查暂存范围后提交发布元数据
git add package.json package-lock.json docs/release-notes-2.3.0.md
git diff --cached --check
git diff --cached --stat
git commit -m "chore(release): 发布 v2.3.0"
git push -u origin dev/2.3.0
```

随后创建 `dev/2.3.0` → `master` 的发布 PR，标题为 `chore(release): 发布 v2.3.0`。审核版本范围、验证结果和发行说明后，使用 **Merge commit** 合并；不得先在 dev 打正式标签，也不对整条 dev 使用 Squash/rebase merge。

合并后确认 master 的 Source checks 通过，再从 master 触发发布工作流：

```bash
git fetch origin master --tags
git show origin/master:package.json | grep '"version"'   # 应为目标版本
git ls-remote --tags origin refs/tags/v2.3.0              # 应无输出
gh workflow run release.yml --repo Yyyangshenghao/simple-music --ref master -f channel=stable
gh run list --repo Yyyangshenghao/simple-music --workflow Release --limit 1   # 取 run id 后 gh run watch <id> --exit-status
```

工作流按 `prepare`（校验分支、版本未被占用、发行说明）→ `package`（双平台测试、正式签名、打包、产物检查）→ `publish`（建草稿 Release 并上传全部文件，最后一次性公开）执行。**tag 由 `publish` 在公开 Release 时创建，指向触发时的 master 提交**；之前任何一步失败都不会留下 tag，修复后用同一版本号重新触发即可。

- 不再手动创建或推送 `v*` tag：工作流不监听 tag 推送，手动推送的 tag 不会发布，反而会占住版本号让工作流拒绝发布。
- 想先确认能打包而不发布时加 `-f dry_run=true`，安装包可在该次运行的 Artifacts 里下载。
- 工作流用触发时的固定提交构建；同一时间只运行一个发布，后触发的排队等待。

### 0.5 发布后的验收

触发发布后不能立即结束任务，必须跟踪 GitHub Actions 到最终状态，并确认 GitHub Release 至少包含：

- macOS Intel 与 Apple Silicon 的 `.dmg`；
- Windows 安装版 `-Setup.exe` 与便携版 `-portable.exe`；
- `latest*.yml` 和对应 blockmap（供应用内更新与完整性校验使用）。

`package` job 打包后由 `scripts/release/check-package.mjs` 自动检查这些必需产物和 asar 内容，草稿传完才公开；自动检查通过后仍需人工核对 Release 页面和文件名。

最后报告目标版本、发布提交、tag、CI 状态、Release 链接和真实剩余风险。Release 公开前失败（无论是基础设施故障还是源码、打包问题）都没有 tag 产生：临时故障直接重跑失败的 job，源码问题修复并合入 master 后用同一版本号重新触发。Release 公开后才发现的问题，发布下一个补丁版本，不移动或覆盖已有 tag。

### 0.5.1 K 歌自托管模型附件

UVR 官方仓库没有的模型由我们自己转换，作为**首次带上它的版本** Release 的附件发布；应用按 `server/lib/karaoke-store.ts` 里固定的地址下载并校验 sha256。目前只有「HQ3 省显存」，挂在 **v2.6.0**：

| 附件 | 生成方式 | sha256 |
|---|---|---|
| `UVR-MDX-NET-Inst_HQ_3-fp16.onnx`（33,398,584 字节） | `scripts/karaoke/convert-hq3-fp16.py` | `62d30044a9e0980efe2daeba0e0f2080fcb23bf8a46b98c0ba5183fe9bf80a9e` |

发布 v2.6.0 时，在 0.5 的工作流完成、Release 已公开后补传附件（工作流的必需产物检查不包含它）：

```bash
uv run --no-project --python 3.11 --with onnx==1.23.2 --with onnxconverter-common==1.16.0 --with numpy==2.4.6 --with protobuf==7.36.2 \
  python scripts/karaoke/convert-hq3-fp16.py /tmp/karaoke-models
gh release upload v2.6.0 /tmp/karaoke-models/UVR-MDX-NET-Inst_HQ_3-fp16.onnx --repo Yyyangshenghao/simple-music
curl -sL https://github.com/Yyyangshenghao/simple-music/releases/download/v2.6.0/UVR-MDX-NET-Inst_HQ_3-fp16.onnx | shasum -a 256
```

- 脚本会下载官方 HQ3、转换并比对登记的 sha256；不一致时停止，不上传。
- 最后一条命令输出必须等于上表的 sha256，否则应用会报「模型校验失败」。
- 之后的版本不再上传，也不要改地址；**不要删除 v2.6.0 的这个附件**，否则所有版本的省显存模型都无法下载。
- 新增自托管模型时，同样挂在当次版本的 Release 上，在本表登记，并在 `karaoke-store.ts` 写入该版本的地址。
- v2.6.0 发布前，开发版下载省显存模型会得到 404，属于预期。

### 0.6 失败与回滚原则

- 发布前失败：保留改动，修复后重新验证，不创建 tag；
- 构建或发布失败：tag 只在 Release 公开时创建，失败时不存在 tag，修复后用同一版本号重新触发；`publish` 重跑会先清掉同名草稿；
- 已公开的 tag 与 Release：禁止静默强推或重写 tag；
- Release 已发布但应用存在严重问题：优先发布更高补丁版本；若需要撤下当前版本，必须由用户明确授权后再调整 GitHub Release 状态；
- 任何时候都不自动删除远端分支、tag、Release 或安装包。

### 0.7 CI 与发布门禁

以下是本仓库的目标验收标准，自动化配置必须与其同步：

| 入口 | 必须完成的检查 | 是否允许发布稳定版 |
|---|---|---|
| feature 合入所属 dev，或已获授权的 dev 本地维护 | 类型检查、全量测试、源码构建；受影响的 UI/播放/登录流程人工检查 | 否 |
| dev 更新、dev PR → master | Windows/macOS 类型检查、全量测试、源码构建；推送后用发版同款步骤双平台试打包（不签名）并检查产物；发布 PR 额外运行 `release-metadata` 检查版本文件和发行说明 | 否 |
| master 更新 | 对合并后的提交执行同上检查与试打包 | 否；通过后才能从 master 触发正式发布 |
| 预发版（从 `dev/X.Y.Z` 触发 `channel=beta`） | 校验分支与目标版本，自动取下一个 `beta.N`；双平台测试、正式签名、打包、产物检查；发为 GitHub 预发布且不标记 latest | 否；只发预发布，不进入应用内更新 |
| 正式版（从 master 触发 `channel=stable`） | 校验来源为 master、版本未占用、版本和说明一致；双平台测试、正式签名、打包、产物检查；全部成功后才创建 tag 并公开 Release | 是 |

- PR 和普通分支 CI 使用只读仓库权限，不使用生产签名凭据、不创建 Release。明确需要预发布时按 §0.7.1 触发预发版，不能伪装成稳定版。
- master 应启用 PR 合并及必需状态检查，发布 PR 要求至少 1 人评审通过；活跃 dev 接收经过本地验收的阶段集成，并在推送后执行双平台 CI。不得以管理员绕过失败检查完成正常发布。
- tag 只由发布工作流创建；建议在 GitHub 规则集中限制他人创建、更新和删除 `v*` tag。稳定发布只接受从 master 触发。
- 工作流默认只读权限，仅 `publish` job 授予 `contents: write`；生产签名凭据只在 `sign: true` 的正式打包中使用，试打包显式跳过签名（`VMP_SIGN=skip`）。发布通过 `concurrency: release` 串行执行。
- **截至 2026-11-03：`verify.yml`（Source checks）对 master/dev 的 PR 与推送执行双平台类型检查、全量测试和源码构建，推送时再调用 `package.yml` 试打包并检查产物，发布 PR 额外校验发版元数据；`release.yml` 改为手动触发，复用同一个 `package.yml` 正式签名打包，成功后才创建 tag 与 Release。master 分支保护（必需检查、PR 评审）与 tag 规则集需在 GitHub 仓库设置中配置，尚未配置前由人工保证，不能声称已由 GitHub 强制。配置落地时同步更新本段。**

### 0.7.1 预发版（验收真实安装包）

预发版相当于发布前的 UAT：正式发布前需要在 Windows/macOS 实机验收与用户一致的安装包时，先推送待发布的 `dev/X.Y.Z`，再从该分支触发：

```bash
gh workflow run release.yml --repo Yyyangshenghao/simple-music --ref dev/2.6.2 -f channel=beta
```

- 目标版本取分支名 `X.Y.Z`，不低于分支 `package.json` 版本；`beta.N` 由工作流在远端已有预发版号上自动加一，不用手动编号，也不需要提交版本号或发行说明，CI 在构建机上把版本写入 `package.json`（测试之后）。
- 走与正式版相同的双平台测试、Widevine 签名与打包，发成 GitHub「预发布」且不标记为 latest。应用内更新只读 `releases/latest`，用户看不到预发版。
- 预发版与正式版共用 appId 和应用数据，装上即覆盖本机正式版；版本比较把 `X.Y.Z-beta.N` 视为低于 `X.Y.Z`，正式版发布后可在应用内直接升级回正式通道。
- 实机验收按对应版本的测试清单执行（如 `docs/reviews/<版本>-windows-test-checklist.md`），结果写入发行说明「验证情况」，注明验收所用的预发版号。
- 修复后重新触发即得到下一个 `beta.N`；失败的运行不会占号。预发版通过不代替 0.3 的发布前检查，正式版仍走 dev → master → 发布工作流。
- 预发版 tag 和 Release 可在正式版发布后由所有者决定是否清理，不自动删除。
- GitHub 只允许手动触发默认分支 master 上已有的工作流：新流程随首个合入 master 的版本（2.6.2）生效，在此之前无法从 dev 触发预发版。

### 0.8 紧急补丁与旧版本维护

- 默认补丁仍遵循正常流程：从最新 master 创建目标补丁 dev，从 dev 创建修复 feature，通过 PR 验收并合入 dev；所有者本地维护例外沿用协作规范。验收后合入 master，验证 master 提交后触发发布工作流，再将 master 的修复同步到仍在维护的新版本 dev。
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

- **main**：入口 `electron/main.ts` → `out/main/index.js`（package.json `main` 指向它），普通实例动态加载 `electron/application.ts`，分离实例只加载计算入口。主进程 chunk 平铺在 `out/main/`，以保留 `import.meta.dirname` 的资源相对路径；不得改为嵌套 `chunks/` 而不调整资源定位。`externalizeDepsPlugin` 把 node_modules 依赖保持 external（打包时由 electron-builder 收进 asar）。
- **preload**：三个入口 `index`（主窗口）+ `overlay`（悬浮窗）+ `karaoke-helper`（伴奏分离）→ `out/preload/{index,overlay,karaoke-helper}.cjs`。全部 BrowserWindow 开启 `sandbox: true`，所以 preload 强制输出 CommonJS；主进程引用对应 `.cjs` 文件。
- **renderer**：`root: '.'`，**多页构建**——`index.html`（主窗口）、`playback-host.html`、`karaoke-helper.html` 及 desktop-lyrics、wallpaper、mini-player 三个 overlay HTML，共六个入口共享 `src/` 代码；别名 `@renderer` → `src`。

dev/prod 的 URL 解析在 `window-manager.ts#resolveRendererUrl`：dev 用环境变量 `ELECTRON_RENDERER_URL` 拼相对入口，prod 用 `file://out/renderer/<entry>`。**新增悬浮窗页面必须同时加 renderer.input**，否则 prod 下 404。

## 3. electron-builder 打包

配置内联在 package.json `build` 字段：

- `appId: com.simplemusic.desktop`，产物输出 `dist/`，资源目录 `build/`（icon.ico/icon.icns）。
- `files`: `out/**/*` + `build/icon.ico` + `package.json`（**package.json 必须进 asar**——server/lib/update.ts 运行时 `import pkgJson from '../../package.json'` 读版本与更新配置）。
- **伴奏原生运行库**：`onnxruntime-node` 的 `bin/**/*` 整体加入 `asarUnpack`，保留 `.node` 与相邻动态库。各平台 `files` 按目标 `${arch}` 排除其他平台和架构；macOS 仅保留绑定使用的 `libonnxruntime.1.dylib`，排除内容重复的完整版本库。`.npmrc` 禁止额外下载未使用的 CUDA/TensorRT。当前 1.30.0 包未附 macOS x64 原生绑定，Intel Mac 走浏览器 WebGPU 回退；发布前仍需对应平台实机生成、取消及重试验收。
- **mac**：dmg，x64 + arm64 双架构分别出包；`identity: null` 即**不签名**——这决定了更新安装方案（见 §5）。分发文件名 `Simple-Music-<v>-arm64.dmg` / `Simple-Music-<v>-x64.dmg`。
- **win**：NSIS（`Simple-Music-<v>-Setup.exe`，非 oneClick、建快捷方式）+ portable（`Simple-Music-<v>-portable.exe`，不参与自动更新）。`allowToChangeInstallationDirectory: false` 关闭 electron-builder 自带目录页，`build/installer.nsh` 再提供品牌化的单个自定义目录页，避免重复并保留自由选盘/路径与 `/D=` 支持。
- 安装包名称显式使用连字符，避免 GitHub 上传时替换空格，导致 `latest*.yml` 中的文件名与 Release 资源不一致。
- **Apple Music DRM**：桌面运行时使用 CastLabs ECS。发布流水线固定 Node 22.12，并在 macOS 的 `afterPack`（系统代码签名前）和 Windows 的 `afterSign`（系统代码签名后）调用 EVS，生成 streaming VMP 生产签名。CI 缺少 `EVS_ACCOUNT_NAME` 或 `EVS_PASSWD` 时必须中止，禁止发布只能使用开发 DRM 签名的安装包；本地普通打包默认跳过，设置 `VMP_SIGN=1` 可强制执行。

## 4. 发布约定

- GitHub Releases（仓库 `Yyyangshenghao/simple-music`），tag 形如 `v1.3.0`，由发布工作流在 Release 公开时创建；预发版 `v1.3.0-beta.1` 发为预发布，更新检查读取的 `releases/latest` 不包含它。github 发布目标下 electron-builder 不按版本号切换通道，预发版同样生成 `latest*.yml`，只随预发布 Release 上传。
- Release 资源命名必须匹配更新器的挑选正则（`server/lib/update.ts#pickReleaseAsset`）：
  - mac：优先 `<arch>.*\.dmg`，回退任意 `.dmg`；
  - win：优先 `-Setup.exe`，其次非 portable 的 `.exe`、`.msi`；
  - **找不到匹配当前平台的资源返回 null → 前端收到 `UPDATE_ASSET_MISSING`**，不会错发别的平台安装包（曾有给 mac 用户发 portable.exe 的教训，pickReleaseAsset 的平台过滤即为此而生）。
- Release body 前几行会被 `extractReleaseNotes` 提取为更新弹窗要点（每行 ≤72 字符、最多 4 条、跳过链接和 "What's Changed" 标题）。
- electron-builder 生成的 `latest.yml` 与 `latest-mac.yml` 必须一并上传：GitHub API 被限流/失败时按平台读取对应备用清单；macOS 从清单中选择当前架构的 dmg，并使用该文件自身的摘要和大小，没有匹配资源时不返回其他平台安装包。

## 5. 半自动更新全链路

设计文档：`docs/superpowers/plans/2026-07-12-semi-auto-update.md`。"半自动" = 检查/下载全自动，安装需用户点一下。

```
渲染层 update store（startUpdateAutoCheck：App 启动即检查；之后每 30 分钟判断一次，距上次满 6 小时再查；
                     窗口回到前台时距上次满 1 小时补查。下载/安装中不替换版本信息，检测失败的兜底结果不冲掉已显示的新版本）
  → GET /api/update/latest
      server: manifest 覆盖(env) → GitHub API /releases/latest → 失败退对应平台的 latest.yml / latest-mac.yml → 再失败本地回退(不报可用更新)
  → UpdateBanner / 设置页显示「发现新版本」
  → POST /api/update/download        # 创建下载任务(有同版本活跃任务则复用;本地已有校验通过的缓存包直接 ready)
  → 轮询 GET /api/update/download/status?id=   # 800ms，进度/速度/ETA/当前线路/失败原因
      server: 候选线路 = 镜像×资源URL + GitHub 直连(preferMirrors 决定顺序)，逐线路重试;
              镜像线路必须有 sha256/sha512 digest 才允许(防镜像缓存投毒);
              下载完成后 size + sha256 + sha512 三重校验，.download 临时文件 rename 落位 userData/updates/downloads/，
              同目录其他安装包随即删除（只留这一个）
  → job.status === 'ready' → 用户点「重启并安装」
  → window.desktop.installUpdate(filePath, version) → IPC app:install-update
      主进程校验 filePath 必须位于配置的更新目录内（默认 userData/updates/）→
      · Windows: spawn NSIS 安装包 /S --force-run（与 electron-updater 参数一致，按注册表原地升级）→ app.quit()
      · macOS:   预检 → hdiutil 挂载 dmg，ditto 解到 userData/updates/staging/ → 核对 bundle id / 版本 / 可执行文件
                 → 写 updates/mac-swap.sh 并 detached 启动 → app.quit()
                 脚本等旧进程退出 → 旧版 mv 到 updates/backup/、新版 mv 到原位 → open 新版；
                 任一步不满足（预检、挂载、核对）直接改为 shell.openPath(dmg) 让用户拖入；
                 脚本失败则回滚旧版、重新拉起并打开 dmg。结果写 updates/install-result.json
  → 下次启动：cleanupUpdatesOnStartup 清旧安装包与 staging/backup，取走替换结果，渲染层 toast 提示一次
```

补充细节：

- 更新安装成功与应用重启复用 `before-quit` 清理悬浮窗和 Apple 播放会话；清理卡住时保留 8 秒强制退出兜底。
- **补丁热更新（/api/update/patch）在新架构不支持**：原项目"源码即运行文件"，补丁按文件名写回；本项目源码经打包后与产物不对应。端点与任务队列结构保留，但应用补丁一步显式抛 `PATCH_NOT_SUPPORTED`（不静默成功、不写文件、不换线路重试）。
- **macOS 原地替换只在 userData 里做重活**：应用只有 adhoc 签名，用不了 Squirrel.Mac。旧方案（f347fde 撤掉）把 `.app.new` 暂存在 `/Applications` 旁，中断即留孤儿目录；现在新版先在 `updates/staging/` 解出并核对，`/Applications` 里只发生两次同卷 rename。预检不满足时（未打包、从 `/Volumes` 或 AppTranslocation 运行、安装目录不可写、暂存与安装目录跨卷）回退为打开 dmg。发版包 `codesign --verify` 本身不通过（adhoc 未封存资源），不能作校验条件。adhoc 签名每次构建都变，系统授权（如麦克风）升级后可能要重新允许。
- **更新目录清理**：下载完成后删同目录其他安装包（`.download` 进行中与 `.invalid-*` 待排查文件除外）；启动时删版本号不比当前新的安装包、`.download`、`.invalid-*`，以及 `staging/`、`backup/`、`mac-swap.sh`（替换结果为 `ROLLBACK_FAILED` 时保留 `backup/`，那是旧版唯一一份）。取不到版本号的文件不删。逻辑在 `server/lib/update-cleanup.ts`。
- 下载错误分类（`classifyUpdateError`）：hash/size 不符、超时、DNS、网络中断、HTTP 403/404/5xx 均映射为中文原因给 UI；失败线路记录在 `failedAttempts`（最多 6 条）。
- 任务表 `updateDownloadJobs` 是内存 Map，保留最近 8 个任务。
- 下载与安装共用更新目录计算：显式 `SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR` 优先作为下载及安装允许目录；未设置时，下载位于更新工作目录的 `downloads/` 子目录，安装仍限定在工作目录内（`SIMPLEMUSIC_UPDATE_DIR` 或默认 `userData/updates/`）。目录外及路径越界的安装请求继续拒绝。

## 6. 环境变量（构建/更新相关）

| 变量 | 作用 |
|---|---|
| `ELECTRON_RENDERER_URL` | electron-vite dev 自动注入，主进程据此加载 vite dev server |
| `PORT` | `server:dev` 独立运行时的监听端口（默认 35530） |
| `SIMPLEMUSIC_VERSION` | 覆盖上报版本（更新调试用） |
| `SIMPLEMUSIC_UPDATE_REPOSITORY` / `_OWNER` / `_REPO` | 覆盖更新仓库 |
| `SIMPLEMUSIC_UPDATE_MIRRORS`（或 `_MIRROR`） | 覆盖镜像列表（逗号/分号/换行分隔） |
| `SIMPLEMUSIC_UPDATE_MANIFEST`（`_URL`/`_FILE`） | 指向自托管更新 manifest（http(s)/file/本地路径），设置后跳过 GitHub 检查 |
| `SIMPLEMUSIC_UPDATE_DIR` / `SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR` | 覆盖更新工作/下载目录，下载目录覆盖优先，安装校验沿用同一配置（见 §5） |
| `SIMPLEMUSIC_BEAT_CACHE_DIR` | 覆盖节拍图缓存目录（默认 userData/beatmaps） |
| `SIMPLEMUSIC_NO_DESKTOP_SHORTCUT` / `SIMPLEMUSIC_CREATE_DESKTOP_SHORTCUT` | win32 桌面快捷方式开关（未打包默认不建） |
| `EVS_ACCOUNT_NAME` / `EVS_PASSWD` | CastLabs EVS 生产 VMP 签名账号；发布 CI 必填并保存为同名 GitHub Actions secrets |
| `VMP_SIGN` | 本地设为 `1` 时强制运行 EVS VMP 签名；CI 始终要求签名凭据 |
