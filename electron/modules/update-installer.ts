// electron/modules/update-installer.ts
import { shell } from 'electron'
import { spawn } from 'node:child_process'

export interface InstallResult {
  ok: boolean
  error?: string
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

// ---------- macOS：没有签名证书，做不了 Squirrel.Mac 式的原地静默替换 ----------
// 早期版本用 hdiutil 挂载 + ditto/mv 脚本在后台自己换目录，但失败路径很难做到万无一失
// （权限不足、进程被中断都可能把 .app.new 留在 /Applications 里）。改成直接把 dmg 交给
// Finder：`open` 一个 dmg 就是挂载卷 + 弹出标准的"拖到 Applications"安装器窗口，
// 替换动作完全由系统和用户完成，主进程不再插手，也就没有半途而废的状态。
export async function installUpdateMac(dmgPath: string): Promise<InstallResult> {
  const error = await shell.openPath(dmgPath)
  return error ? { ok: false, error } : { ok: true }
}
