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
