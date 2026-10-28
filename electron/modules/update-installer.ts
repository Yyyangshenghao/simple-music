// electron/modules/update-installer.ts
import { app, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  cleanupUpdateArtifacts,
  INSTALL_RESULT_FILE,
  MAC_SWAP_SCRIPT,
  type MacInstallResultRecord,
} from '../../server/lib/update-cleanup'
import { compareVersions } from '../../server/lib/update-version'
import { updateWorkDir } from '../../server/lib/update-download-dir'
import {
  buildMacSwapScript,
  macInstallPreflight,
  resolveMacAppBundlePath,
} from './update-installer-logic'

const execFileAsync = promisify(execFile)

export interface InstallResult {
  ok: boolean
  error?: string
  /** macOS：'swap' 为后台原地替换，'dmg' 为回退成打开安装包让用户手动拖入 */
  mode?: 'swap' | 'dmg'
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

// ---------- 启动清理：旧安装包、mac 替换残留，并取走上次替换结果交给渲染层提示一次 ----------
let lastMacInstall: MacInstallResultRecord | null = null

export function cleanupUpdatesOnStartup(): void {
  try {
    lastMacInstall = cleanupUpdateArtifacts(app.getPath('userData'), app.getVersion())
  } catch (e) {
    console.warn('[UpdateCleanup] startup cleanup failed:', (e as Error).message)
  }
}

export function takeLastMacInstall(): MacInstallResultRecord | null {
  const record = lastMacInstall
  lastMacInstall = null
  return record
}

// ---------- macOS：暂存核对后原地替换，任何一步不满足就回退为打开 dmg ----------
// 应用只有 adhoc 签名，做不了 Squirrel.Mac。新版先在 updates/staging 里从 dmg 解出并核对
// （bundle id、版本号、可执行文件），确认无误才写替换脚本并退出；/Applications 里只剩两次同卷
// rename，脚本失败会回滚旧版并打开 dmg。见 update-installer-logic.ts。
// 注：发版包 codesign --verify 本身就不通过（adhoc 未封存资源），不能拿它当校验条件。
export async function installUpdateMac(dmgPath: string, expectedVersion?: string): Promise<InstallResult> {
  try {
    return await stageMacUpdate(dmgPath, expectedVersion)
  } catch (e) {
    console.warn('[UpdateInstall] in-place update unavailable, opening dmg:', (e as Error).message)
    return openMacDmg(dmgPath)
  }
}

async function openMacDmg(dmgPath: string): Promise<InstallResult> {
  const error = await shell.openPath(dmgPath)
  return error ? { ok: false, error } : { ok: true, mode: 'dmg' }
}

function isWritable(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function plistValue(plistPath: string, key: string): Promise<string> {
  const { stdout } = await execFileAsync('plutil', ['-extract', key, 'raw', '-o', '-', plistPath])
  return String(stdout).trim()
}

async function stageMacUpdate(dmgPath: string, expectedVersion?: string): Promise<InstallResult> {
  const appPath = resolveMacAppBundlePath(app.getPath('exe'))
  const workDir = updateWorkDir(app.getPath('userData'))
  const stagingDir = path.join(workDir, 'staging')
  const backupDir = path.join(workDir, 'backup')
  fs.mkdirSync(stagingDir, { recursive: true })
  fs.mkdirSync(backupDir, { recursive: true })

  const installDir = appPath ? path.dirname(appPath) : ''
  const preflight = macInstallPreflight({
    isPackaged: app.isPackaged,
    appPath,
    writable: !!appPath && isWritable(installDir) && isWritable(appPath),
    sameVolume: !!appPath && fs.statSync(installDir).dev === fs.statSync(workDir).dev,
  })
  if (!preflight.ok) throw new Error(preflight.reason)
  const currentApp = appPath as string

  const stagedApp = path.join(stagingDir, path.basename(currentApp))
  fs.rmSync(stagedApp, { recursive: true, force: true })
  const mountDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'simplemusic-update-'))
  try {
    await execFileAsync('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-noverify', '-mountpoint', mountDir])
    const bundles = fs.readdirSync(mountDir).filter((name) => name.endsWith('.app'))
    if (bundles.length !== 1) throw new Error('DMG_APP_NOT_FOUND')
    await execFileAsync('ditto', [path.join(mountDir, bundles[0]), stagedApp])
  } finally {
    await execFileAsync('hdiutil', ['detach', mountDir, '-quiet', '-force']).catch(() => undefined)
    fs.rmSync(mountDir, { recursive: true, force: true })
  }

  const stagedPlist = path.join(stagedApp, 'Contents', 'Info.plist')
  const currentPlist = path.join(currentApp, 'Contents', 'Info.plist')
  const [stagedId, currentId, stagedVersion, executable] = await Promise.all([
    plistValue(stagedPlist, 'CFBundleIdentifier'),
    plistValue(currentPlist, 'CFBundleIdentifier'),
    plistValue(stagedPlist, 'CFBundleShortVersionString'),
    plistValue(stagedPlist, 'CFBundleExecutable'),
  ])
  if (stagedId !== currentId) throw new Error('STAGED_BUNDLE_ID_MISMATCH')
  if (compareVersions(stagedVersion, app.getVersion()) <= 0) throw new Error('STAGED_VERSION_NOT_NEWER')
  if (expectedVersion && compareVersions(stagedVersion, expectedVersion) !== 0) throw new Error('STAGED_VERSION_MISMATCH')
  fs.accessSync(path.join(stagedApp, 'Contents', 'MacOS', executable), fs.constants.X_OK)
  await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', stagedApp]).catch(() => undefined)

  const scriptPath = path.join(workDir, MAC_SWAP_SCRIPT)
  fs.writeFileSync(
    scriptPath,
    buildMacSwapScript({
      pid: process.pid,
      appPath: currentApp,
      stagedAppPath: stagedApp,
      backupPath: path.join(backupDir, path.basename(currentApp)),
      dmgPath,
      logPath: path.join(workDir, 'install.log'),
      resultPath: path.join(workDir, INSTALL_RESULT_FILE),
      fromVersion: app.getVersion(),
      toVersion: stagedVersion,
    }),
    { mode: 0o755 }
  )
  // detached 脱离主进程生命周期：主进程退出后脚本继续等它结束、替换并拉起新版本。
  const child = spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  return { ok: true, mode: 'swap' }
}
