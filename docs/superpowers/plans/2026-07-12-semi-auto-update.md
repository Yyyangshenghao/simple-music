# 更新体验半自动化(静默安装 + 自动重启) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"下载完安装包后用户手动挂载 dmg / 点开 exe 安装向导"改成"下载完点一下按钮,应用自动退出→静默安装→自动重启到新版本",Mac 和 Windows 都覆盖,且不引入付费 Apple 开发者证书。

**Architecture:** 保留现有自研更新链路不变(`server/lib/update.ts` 的 GitHub Releases 检测 + 镜像下载 + sha256/sha512 校验完全复用)。只替换"拿到已校验的安装包之后"这一步:新增 `electron/modules/update-installer.ts`,内部按平台分流 —— Windows 用 NSIS 安装包自带的静默参数 `/S --force-run`(与 `electron-updater` 官方 NsisUpdater 的 `doInstall()` 实现同款做法)后台 spawn 后退出;macOS 没有签名证书用不了 Squirrel.Mac,改成主进程用 `hdiutil` 挂载 dmg、原子换目录(`mv` 到位再删旧的,失败自动回滚)、`open` 拉起新版本。纯逻辑(路径解析、脚本文本生成)拆到独立的 `update-installer-logic.ts`,不依赖 Electron API,可单测;真正调用 Electron/子进程 API 的部分不写单测(与 `electron/` 目录现状一致,该目录目前没有任何测试文件,只能靠打包后手动验证)。

**Tech Stack:** Electron `child_process.spawn`/`execFileSync`、macOS `hdiutil`/`ditto`/`open` shell 命令、Windows NSIS `/S` 静默安装参数,不引入 `electron-updater` 或其它新依赖。

## Global Constraints

- 不引入 `electron-updater` 依赖,不改 `package.json` 的 `build.mac.target`(继续用 dmg,不换 zip)。
- 不要求用户购买 Apple Developer 证书;`mac.identity: null`(未签名)现状不变。
- 复用现有下载链路的 sha256/sha512 校验结果,不重复校验、不重新发起下载。
- Windows 端沿用现有 nsis 配置(`oneClick: false`、`perMachine: false`),不新增 `/D=` 自定义安装目录参数,让 NSIS 按注册表里已有的安装路径原地升级。
- macOS 端任何失败路径都不能把用户晾在"应用已退出、新旧版本都不在"的状态 —— 必须能回滚到旧版本并重新拉起。
- 所有涉及真实文件系统/进程操作的代码只做手动验证(见 Task 8),不写自动化测试;可单测的部分(路径解析、脚本文本生成)必须先写测试。

---

## File Structure

- `electron/modules/update-installer-logic.ts`(新建)— 纯函数:`resolveMacAppBundlePath()`、`buildMacSwapScript()`。不 import `electron`,可在 vitest 里直接跑。
- `electron/modules/update-installer-logic.test.ts`(新建)— 上面两个函数的单测。
- `electron/modules/update-installer.ts`(新建)— Electron/子进程胶水代码:`installUpdateWindows()`、`installUpdateMac()`。
- `electron/ipc/misc.ts`(修改)— `app:open-update` handler 重命名为 `app:install-update`,按平台分流调用上面两个函数。
- `src/types/ipc.ts`(修改)— IPC 通道类型重命名。
- `electron/preload/index.ts`(修改)— `openUpdateInstaller` 重命名为 `installUpdate`。
- `src/stores/update.ts`(修改)— `openInstaller` 重命名为 `installUpdate`,新增 `installing` 状态。
- `src/pages/SettingsPage.tsx`(修改)— "立即安装"按钮改为"重启并安装",接 `installing` 状态。
- `src/components/Update/UpdateBanner.tsx`(修改,Task 4 审查阶段发现原计划遗漏)— 顶部更新提示条,同样的按钮文案/禁用处理。
- `docs/modules/electron-main.md`(修改)— 同步新模块 + 重命名后的 IPC 通道名。

---

### Task 1: 更新安装流程的纯逻辑(可单测部分)

**Files:**
- Create: `electron/modules/update-installer-logic.ts`
- Test: `electron/modules/update-installer-logic.test.ts`

**Interfaces:**
- Produces: `resolveMacAppBundlePath(exePath: string): string | null`、`buildMacSwapScript(options: { dmgPath: string; appPath: string; logPath: string }): string`(供 Task 2 的 `update-installer.ts` 消费)

- [ ] **Step 1: 写失败测试**

```typescript
// electron/modules/update-installer-logic.test.ts
import { describe, it, expect } from 'vitest'
import { resolveMacAppBundlePath, buildMacSwapScript } from './update-installer-logic'

describe('resolveMacAppBundlePath', () => {
  it('从可执行文件路径反推 .app bundle 根目录', () => {
    expect(resolveMacAppBundlePath('/Applications/SimpleMusic.app/Contents/MacOS/SimpleMusic')).toBe(
      '/Applications/SimpleMusic.app'
    )
  })

  it('路径不带 .app/Contents/MacOS 结构时返回 null，避免误删无关目录', () => {
    expect(resolveMacAppBundlePath('/usr/local/bin/simplemusic')).toBeNull()
  })

  it('用户级安装路径（带空格）也能正确解析', () => {
    expect(
      resolveMacAppBundlePath('/Users/foo/Applications/Simple Music.app/Contents/MacOS/Simple Music')
    ).toBe('/Users/foo/Applications/Simple Music.app')
  })
})

describe('buildMacSwapScript', () => {
  const script = buildMacSwapScript({
    dmgPath: '/tmp/SimpleMusic-1.2.0.dmg',
    appPath: '/Applications/SimpleMusic.app',
    logPath: '/tmp/install.log',
  })

  it('挂载失败（找不到 .app）时不动旧安装，直接重启旧版本', () => {
    const beforeSwap = script.split('NEW_APP=')[0]
    expect(beforeSwap).toContain('SRC_APP_NOT_FOUND')
    expect(beforeSwap).not.toContain('mv "$APP_PATH"')
  })

  it('替换失败时从备份回滚，而不是留下一个空目录', () => {
    expect(script).toContain('SWAP_FAILED_ROLLBACK')
    expect(script).toContain('mv "$OLD_BACKUP" "$APP_PATH"')
  })

  it('嵌入调用方传入的 dmg 路径与 app 路径', () => {
    expect(script).toContain('DMG="/tmp/SimpleMusic-1.2.0.dmg"')
    expect(script).toContain('APP_PATH="/Applications/SimpleMusic.app"')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run electron/modules/update-installer-logic.test.ts`
Expected: FAIL,报 `Cannot find module './update-installer-logic'`

- [ ] **Step 3: 写最小实现**

```typescript
// electron/modules/update-installer-logic.ts
// 更新安装流程中不依赖 Electron API 的纯逻辑，独立于 update-installer.ts 以便单测
// （electron/ 目录下其余文件都要跑在真实 Electron 进程里，这里是唯一能单测的部分）。

export interface MacSwapScriptOptions {
  dmgPath: string
  appPath: string
  logPath: string
}

/** 从 app.getPath('exe') 反推 .app bundle 根目录：
 *  .../SimpleMusic.app/Contents/MacOS/SimpleMusic -> .../SimpleMusic.app */
export function resolveMacAppBundlePath(exePath: string): string | null {
  const match = String(exePath || '').match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/)
  return match ? match[1] : null
}

/** 生成"挂载 dmg → 原子替换 .app → 失败回滚 → 重启"的 bash 脚本文本。
 *  这段脚本以 detached 子进程运行，在主进程退出后继续完成安装并重新拉起新版本，
 *  所以任何一步失败都必须能回滚到旧版本，不能把用户晾在"新旧版本都不在"的状态。 */
export function buildMacSwapScript(options: MacSwapScriptOptions): string {
  const { dmgPath, appPath, logPath } = options
  return `#!/bin/bash
exec > "${logPath}" 2>&1
set -e
DMG="${dmgPath}"
APP_PATH="${appPath}"
MOUNT_DIR=$(mktemp -d)
cleanup() { hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true; }
trap cleanup EXIT

hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT_DIR"
SRC_APP=$(find "$MOUNT_DIR" -maxdepth 1 -name "*.app" | head -n1)
if [ -z "$SRC_APP" ]; then
  echo "SRC_APP_NOT_FOUND"
  open "$APP_PATH"
  exit 1
fi

NEW_APP="$APP_PATH.new"
rm -rf "$NEW_APP"
ditto "$SRC_APP" "$NEW_APP"
xattr -dr com.apple.quarantine "$NEW_APP" 2>/dev/null || true

OLD_BACKUP="$APP_PATH.old"
rm -rf "$OLD_BACKUP"
mv "$APP_PATH" "$OLD_BACKUP"
if mv "$NEW_APP" "$APP_PATH"; then
  rm -rf "$OLD_BACKUP"
  open "$APP_PATH"
else
  echo "SWAP_FAILED_ROLLBACK"
  mv "$OLD_BACKUP" "$APP_PATH"
  open "$APP_PATH"
  exit 1
fi
`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run electron/modules/update-installer-logic.test.ts`
Expected: PASS(6 个用例全绿)

- [ ] **Step 5: Commit**

```bash
git add electron/modules/update-installer-logic.ts electron/modules/update-installer-logic.test.ts
git commit -m "feat: 抽取 mac 静默安装的纯逻辑并补单测"
```

---

### Task 2: Windows / macOS 静默安装(Electron 胶水代码,无单测)

**Files:**
- Create: `electron/modules/update-installer.ts`

**Interfaces:**
- Consumes: Task 1 的 `resolveMacAppBundlePath(exePath)`、`buildMacSwapScript(options)`
- Produces: `installUpdateWindows(installerPath: string): Promise<InstallResult>`、`installUpdateMac(dmgPath: string): InstallResult`,`InstallResult = { ok: boolean; error?: string }`(供 Task 3 的 IPC handler 消费)

这个文件要 `import { app } from 'electron'`,在 vitest(node 环境,不加载 Electron 运行时)里 import 就会报错,所以不写单测 —— 与 `electron/` 目录里其它文件(`main.ts`、`ipc/*.ts`、`modules/window-manager.ts` 等)的现状一致,均无对应 `.test.ts`。正确性靠 Task 8 的手动打包验证。

- [ ] **Step 1: 直接写实现(无测试步骤)**

```typescript
// electron/modules/update-installer.ts
import { app } from 'electron'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveMacAppBundlePath, buildMacSwapScript } from './update-installer-logic'

export interface InstallResult {
  ok: boolean
  error?: string
}

function updateWorkDir(): string {
  return path.join(app.getPath('userData'), 'updates')
}

// ---------- Windows：spawn NSIS 安装包做静默更新 ----------
// /S + --force-run 与 electron-updater 官方 NsisUpdater.doInstall() 的参数一致：
// /S 跳过安装向导 UI，--force-run 确保静默安装完成后仍会拉起新版本。
// 不传 /D=，让 NSIS 按注册表里记录的已有安装目录原地升级。
export function installUpdateWindows(installerPath: string): Promise<InstallResult> {
  return new Promise((resolve) => {
    const child = spawn(installerPath, ['/S', '--force-run'], { detached: true, stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.unref()
      resolve({ ok: true })
    }, 1500)
    child.once('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: err.message || 'SPAWN_FAILED' })
    })
    child.once('spawn', () => {
      clearTimeout(timer)
      child.unref()
      resolve({ ok: true })
    })
  })
}

// ---------- macOS：先挂载校验一次，确认能装了再退出应用 ----------
// 不做这一步预检的话，一旦 hdiutil attach 失败（磁盘空间、权限等），
// 应用已经退出但安装没有真正发生，用户会以为软件消失了。
function preflightMacDmg(dmgPath: string): InstallResult {
  const mountDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'simplemusic-update-'))
  try {
    execFileSync('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountDir], {
      stdio: 'ignore',
    })
    const hasApp = fs.readdirSync(mountDir).some((name) => name.endsWith('.app'))
    if (!hasApp) return { ok: false, error: 'DMG_APP_NOT_FOUND' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'DMG_MOUNT_FAILED' }
  } finally {
    try {
      execFileSync('hdiutil', ['detach', mountDir, '-quiet'], { stdio: 'ignore' })
    } catch {
      /* ignore */
    }
    try {
      fs.rmdirSync(mountDir)
    } catch {
      /* ignore */
    }
  }
}

export function installUpdateMac(dmgPath: string): InstallResult {
  const appPath = resolveMacAppBundlePath(app.getPath('exe'))
  if (!appPath) return { ok: false, error: 'APP_BUNDLE_NOT_FOUND' }

  const preflight = preflightMacDmg(dmgPath)
  if (!preflight.ok) return preflight

  const dir = updateWorkDir()
  fs.mkdirSync(dir, { recursive: true })
  const scriptPath = path.join(dir, 'mac-install.sh')
  const logPath = path.join(dir, 'install.log')
  fs.writeFileSync(scriptPath, buildMacSwapScript({ dmgPath, appPath, logPath }), { mode: 0o755 })

  // detached 脱离主进程生命周期，主进程 app.exit(0) 之后这段脚本继续跑完剩下的
  // 挂载 → 原子替换 → 重启新版本；失败会在脚本内部回滚到旧版本，见 Task 1 的 buildMacSwapScript。
  const child = spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  return { ok: true }
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: 通过,无新增类型错误

- [ ] **Step 3: Commit**

```bash
git add electron/modules/update-installer.ts
git commit -m "feat: 新增 Windows/macOS 静默安装的主进程实现"
```

---

### Task 3: IPC handler 改造(`app:open-update` → `app:install-update`)

**Files:**
- Modify: `electron/ipc/misc.ts:65-76`
- Modify: `src/types/ipc.ts:131`

**Interfaces:**
- Consumes: Task 2 的 `installUpdateWindows`、`installUpdateMac`

- [ ] **Step 1: 改 IPC 类型定义**

`src/types/ipc.ts:131`,把:

```typescript
  'app:open-update': { req: { filePath: string }; res: OkResult }
```

改成:

```typescript
  'app:install-update': { req: { filePath: string }; res: OkResult }
```

- [ ] **Step 2: 改主进程 handler**

`electron/ipc/misc.ts` 顶部加 import:

```typescript
import { installUpdateMac, installUpdateWindows } from '../modules/update-installer'
```

把第 65-76 行的 `app:open-update` handler 整个替换成:

```typescript
  ipcMain.handle('app:install-update', async (_e, arg: { filePath: string }): Promise<OkResult> => {
    try {
      const target = resolve(String(arg?.filePath ?? ''))
      const updateDir = resolve(getUpdateDownloadDir())
      if (!target || !target.startsWith(updateDir + sep)) return { ok: false, error: 'INVALID_UPDATE_PATH' }
      if (!existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' }

      if (process.platform === 'win32') {
        const result = await installUpdateWindows(target)
        if (!result.ok) return result
        app.exit(0)
        return { ok: true }
      }
      if (process.platform === 'darwin') {
        const result = installUpdateMac(target)
        if (!result.ok) return result
        app.exit(0)
        return { ok: true }
      }
      // 其它平台没有对应的打包产物，保留旧行为兜底
      const error = await shell.openPath(target)
      return error ? { ok: false, error } : { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'INSTALL_UPDATE_FAILED' }
    }
  })
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/misc.ts src/types/ipc.ts
git commit -m "feat: app:open-update 改为按平台静默安装的 app:install-update"
```

---

### Task 4: preload + store 改名与状态改造

**Files:**
- Modify: `electron/preload/index.ts:69`
- Modify: `src/stores/update.ts`

**Interfaces:**
- Consumes: Task 3 的 IPC 通道 `app:install-update`
- Produces: `useUpdateStore` 新增 `installing: boolean` 字段与 `installUpdate(): Promise<void>` 方法(供 Task 5 的 `SettingsPage.tsx` 消费)

- [ ] **Step 1: preload 改名**

`electron/preload/index.ts:69`,把:

```typescript
  openUpdateInstaller: (filePath: string): Promise<OkResult> => ipcRenderer.invoke('app:open-update', { filePath })
```

改成:

```typescript
  installUpdate: (filePath: string): Promise<OkResult> => ipcRenderer.invoke('app:install-update', { filePath })
```

- [ ] **Step 2: store 改名 + 新增 installing 状态**

`src/stores/update.ts` 里,`UpdateStore` interface 的 `openInstaller(): Promise<void>` 改成:

```typescript
  installing: boolean
  installUpdate(): Promise<void>
```

`create<UpdateStore>` 里的初始状态加一行 `installing: false,`(放在 `downloading: false,` 后面)。

把第 127-131 行的 `openInstaller` 方法整个替换成:

```typescript
  async installUpdate() {
    const filePath = get().job?.filePath
    if (!filePath || get().installing) return
    set({ installing: true })
    try {
      const result = await window.desktop?.installUpdate(filePath)
      // 成功时应用即将退出重启，不需要复位 installing；只有失败才复位让用户能重试
      if (result && !result.ok) set({ installing: false })
    } catch {
      set({ installing: false })
    }
  },
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 通过(渲染侧 tsconfig 会检查 `window.desktop.installUpdate` 是否存在,preload 的 `DesktopApi` 类型是从 `api` 对象推导的,改名后自动同步)

- [ ] **Step 4: Commit**

```bash
git add electron/preload/index.ts src/stores/update.ts
git commit -m "feat: preload/store 同步改名为 installUpdate 并跟踪安装中状态"
```

---

### Task 5: 设置页 + 顶部更新提示条按钮改造

> **计划修正(Task 4 审查阶段发现):** 原计划只看到了 `SettingsPage.tsx` 这一个更新入口,漏掉了 `src/components/Update/UpdateBanner.tsx`(顶部横幅,检测到新版本时出现,同样有一个"立即安装"按钮走 `installUpdate`)。Task 4 实现时为了让 typecheck 通过,已经把这个文件里的方法调用从 `openInstaller` 顺手改名成了 `installUpdate`(否则会编译报错),但还没加 `installing` 状态的文案/禁用处理 —— 这部分补在这个任务里。

**Files:**
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/components/Update/UpdateBanner.tsx`

**Interfaces:**
- Consumes: Task 4 的 `useUpdateStore` 的 `installing`、`installUpdate`

- [ ] **Step 1: 改 hook 引用**

`src/pages/SettingsPage.tsx:29`,把:

```typescript
  const openInstaller = useUpdateStore((s) => s.openInstaller)
```

改成:

```typescript
  const installing = useUpdateStore((s) => s.installing)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
```

- [ ] **Step 2: 改按钮**

第 147-150 行:

```typescript
          {ready ? (
            <button className={`${styles.seg} no-drag`} onClick={() => void openInstaller()}>
              立即安装
            </button>
```

改成:

```typescript
          {ready ? (
            <button className={`${styles.seg} no-drag`} disabled={installing} onClick={() => void installUpdate()}>
              {installing ? '正在安装…' : '重启并安装'}
            </button>
```

- [ ] **Step 3: 改顶部更新提示条(UpdateBanner)**

`src/components/Update/UpdateBanner.tsx` 里,加读取 `installing`(Task 4 已经把方法调用从 `openInstaller` 改成了 `installUpdate`,这一步只补文案和禁用状态):

```typescript
  const installing = useUpdateStore((s) => s.installing)
```

放在 `const installUpdate = useUpdateStore((s) => s.installUpdate)` 后面。

把:

```typescript
  const actionLabel = ready ? '立即安装' : downloading ? `下载中 ${job?.progress ?? 0}%` : errored ? '重试下载' : '下载更新'
```

改成:

```typescript
  const actionLabel = ready
    ? installing
      ? '正在安装…'
      : '重启并安装'
    : downloading
      ? `下载中 ${job?.progress ?? 0}%`
      : errored
        ? '重试下载'
        : '下载更新'
```

把按钮的 `disabled` 属性:

```typescript
                disabled={downloading && !ready && !errored}
```

改成:

```typescript
                disabled={(downloading && !ready && !errored) || installing}
```

- [ ] **Step 4: 本地跑起来看一眼**

Run: `npm run dev`,打开设置页,确认"关于"分组按钮文案是"重启并安装"(此时没有可安装的更新包,`ready` 为 false,看不到这个按钮属正常;可以临时把 `ready` 硬编码成 `true` 肉眼确认文案和样式,改完记得撤销)。同样方式确认顶部 `UpdateBanner` 的按钮文案和禁用状态。

- [ ] **Step 5: typecheck + 现有测试**

Run: `npm run typecheck && npm test`
Expected: 全部通过

- [ ] **Step 6: Commit**

```bash
git add src/pages/SettingsPage.tsx src/components/Update/UpdateBanner.tsx
git commit -m "feat: 设置页与更新提示条按钮改为重启并安装"
```

---

### Task 6: 文档同步

**Files:**
- Modify: `docs/modules/electron-main.md`

- [ ] **Step 1: 补模块清单**

在 `docs/modules/electron-main.md` 第 11 行(`modules/login-manager.ts` 那条)后面插入一行:

```markdown
- `modules/update-installer.ts` + `update-installer-logic.ts` — 静默安装更新包:Windows 走 NSIS `/S --force-run` 静默安装,macOS 用 `hdiutil` 挂载 dmg 原地替换 `.app`(未签名,做不了 Squirrel.Mac,失败会自动回滚到旧版本);后者是纯逻辑,前者是 Electron 胶水代码。
```

- [ ] **Step 2: 改 IPC 通道名**

第 24 行,把 `app:open-update` 改成 `app:install-update`。

- [ ] **Step 3: Commit**

```bash
git add docs/modules/electron-main.md
git commit -m "docs: 同步更新安装模块与重命名后的 IPC 通道"
```

---

### Task 7: 手动验证(必须做,前面的 typecheck/unit test 覆盖不到真实安装流程)

这一步涉及真实覆盖本机已安装的 App,**必须先手动确认(不要自动跑)**:

**macOS(可以在当前开发机上验证)：**

- [ ] `npm run build:mac` 打出一个未签名 dmg(比如版本号临时改成 `1.1.2-test` 避免和正式版混淆)
- [ ] 用这个 dmg 走一遍正常首次安装(拖到 `/Applications`),得到一个"旧版本"
- [ ] 改 `package.json` version 到更高号,再打一个 dmg 模拟"新版本"
- [ ] 打开已安装的"旧版本",在设置页走 检查更新 → 下载更新 → 重启并安装 全流程(需要临时把 `simplemusic.update` 指向本地这两个 dmg,或者直接在 `server/lib/update.ts` 的 `fetchLatestUpdateInfo` 临时短路成本地文件路径,验证完记得改回来)
- [ ] 确认:应用自动退出 → 全程无人工点击 → `/Applications` 下的 App 被替换成新版本 → 新版本自动拉起 → 菜单栏/关于页版本号正确
- [ ] 故意验证失败路径:比如把 dmg 文件删掉再点"重启并安装",确认走的是"提示错误、应用不退出",而不是应用退出后卡死

**Windows(当前环境没有 Windows 机器,需要用户自己验证或找人代测)：**

- [ ] `npm run build:win` 打出 nsis 安装包
- [ ] 同样走一遍"旧版本已安装 → 检测到新版本 → 下载 → 重启并安装"全流程
- [ ] 确认:应用自动退出 → 安装向导没有弹出任何界面(全程静默)→ 装完自动拉起新版本

验证通过后再合并;如果 macOS 那边验证发现问题(比如 Gatekeeper 拦截、`ditto` 权限问题),回来改 Task 1/2,不要跳过这一步直接发版。

---

## Self-Review

- **Spec 覆盖**:检测/下载/校验(不动)→ 静默安装(Task 1-2)→ IPC/preload/store 接线(Task 3-4)→ UI(Task 5)→ 文档(Task 6)→ 手动验证(Task 7),对应"Mac + Windows 都要优化、不买证书"的两个约束都在 Global Constraints 里体现。
- **占位符扫描**:无 TBD/待补全,所有代码块可直接使用。
- **类型一致性**:`InstallResult`(Task 2)在 Task 3 的 IPC handler 里直接作为返回值类型使用;`installUpdate()` 方法名在 Task 4(store)、Task 5(组件)、preload(Task 4)里保持一致。
