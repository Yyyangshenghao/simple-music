# 构建、打包与发布/更新流程

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
- **preload**：两个入口 `index`（主窗口）+ `overlay`（悬浮窗）→ `out/preload/{index,overlay}.mjs`。主进程用 `import.meta.dirname + '../preload/index.mjs'` 引用。
- **renderer**：`root: '.'`，**多页构建**——`index.html`（主窗口）、`overlays/desktop-lyrics/desktop-lyrics.html`、`overlays/wallpaper/wallpaper.html` 三个入口共享 `src/` 代码；别名 `@renderer` → `src`。

dev/prod 的 URL 解析在 `window-manager.ts#resolveRendererUrl`：dev 用环境变量 `ELECTRON_RENDERER_URL` 拼相对入口，prod 用 `file://out/renderer/<entry>`。**新增悬浮窗页面必须同时加 renderer.input**，否则 prod 下 404。

## 3. electron-builder 打包

配置内联在 package.json `build` 字段：

- `appId: com.simplemusic.desktop`，产物输出 `dist/`，资源目录 `build/`（icon.ico/icon.icns）。
- `files`: `out/**/*` + `build/icon.ico` + `package.json`（**package.json 必须进 asar**——server/lib/update.ts 运行时 `import pkgJson from '../../package.json'` 读版本与更新配置）。
- **mac**：dmg，x64 + arm64 双架构分别出包；`identity: null` 即**不签名**——这决定了更新安装方案（见 §5）。分发文件名 `SimpleMusic-<v>-arm64.dmg` / `SimpleMusic-<v>.dmg`。
- **win**：NSIS（`SimpleMusic-<v>-Setup.exe`，非 oneClick、可选目录、建快捷方式）+ portable（`SimpleMusic-<v>-portable.exe`，不参与自动更新）。

## 4. 发布约定

- GitHub Releases（仓库 `Yyyangshenghao/simple-music`），tag 形如 `v1.3.0`。
- Release 资源命名必须匹配更新器的挑选正则（`server/lib/update.ts#pickReleaseAsset`）：
  - mac：优先 `<arch>.*\.dmg`，回退任意 `.dmg`；
  - win：优先 `-Setup.exe`，其次非 portable 的 `.exe`、`.msi`；
  - **找不到匹配当前平台的资源返回 null → 前端收到 `UPDATE_ASSET_MISSING`**，不会错发别的平台安装包（曾有给 mac 用户发 portable.exe 的教训，pickReleaseAsset 的平台过滤即为此而生）。
- Release body 前几行会被 `extractReleaseNotes` 提取为更新弹窗要点（每行 ≤72 字符、最多 4 条、跳过链接和 "What's Changed" 标题）。
- electron-builder 生成的 `latest.yml` 建议一并上传：GitHub API 被限流/失败时更新检查会退回 `releases/latest/download/latest.yml` 线路。

## 5. 半自动更新全链路

设计文档：`docs/superpowers/plans/2026-07-12-semi-auto-update.md`。"半自动" = 检查/下载全自动，安装需用户点一下。

```
渲染层 update store（App 启动即 checkForUpdate）
  → GET /api/update/latest
      server: manifest 覆盖(env) → GitHub API /releases/latest → 失败退 latest.yml 线路 → 再失败本地回退(不报可用更新)
  → UpdateBanner / 设置页显示「发现新版本」
  → POST /api/update/download        # 创建下载任务(有同版本活跃任务则复用;本地已有校验通过的缓存包直接 ready)
  → 轮询 GET /api/update/download/status?id=   # 800ms，进度/速度/ETA/当前线路/失败原因
      server: 候选线路 = 镜像×资源URL + GitHub 直连(preferMirrors 决定顺序)，逐线路重试;
              镜像线路必须有 sha256/sha512 digest 才允许(防镜像缓存投毒);
              下载完成后 size + sha256 + sha512 三重校验，.download 临时文件 rename 落位 userData/updates/downloads/
  → job.status === 'ready' → 用户点「重启并安装」
  → window.desktop.installUpdate(filePath) → IPC app:install-update
      主进程校验 filePath 必须位于 userData/updates/ 内 →
      · Windows: spawn NSIS 安装包 /S --force-run（与 electron-updater 参数一致，按注册表原地升级）→ app.exit(0)
      · macOS:   先 hdiutil attach 预检 dmg（失败则不退出应用）→ 写 mac-install.sh（detached bash）→ app.exit(0)
                 脚本：挂载 → ditto 拷出新 .app → 去 quarantine → mv 旧 .app 为 .old → mv 新 .app 落位
                 → 成功删备份并 open；任一步失败回滚 .old 并 open 旧版（不能把用户晾在"新旧都不在"）
                 日志落 userData/updates/install.log
```

补充细节：

- **补丁热更新（/api/update/patch）在新架构不支持**：原项目"源码即运行文件"，补丁按文件名写回；本项目源码经打包后与产物不对应。端点与任务队列结构保留，但应用补丁一步显式抛 `PATCH_NOT_SUPPORTED`（不静默成功、不写文件、不换线路重试）。
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
