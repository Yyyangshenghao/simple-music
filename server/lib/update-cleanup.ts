import fs from 'node:fs'
import path from 'node:path'
import { compareVersions } from './update-version'
import { updateDownloadDir, updateWorkDir } from './update-download-dir'

// 更新目录的清理：安装包每版 135–270MB，过去只覆盖同名文件、从不删旧包，攒到了 GB 级。
// 下载完成后删掉其他安装包；启动时删掉不比当前版本新的安装包，以及 mac 原地替换留下的暂存/备份。

/** mac 替换脚本写下的结果（见 electron/modules/update-installer-logic.ts 的 buildMacSwapScript） */
export interface MacInstallResultRecord {
  ok: boolean
  code: string
  from: string
  to: string
  at: number
}

const INSTALLER_RE = /\.(dmg|exe|msi|zip|7z|AppImage|deb|rpm|patch\.json|patch)$/i
const PARTIAL_SUFFIX = '.download'
export const INSTALL_RESULT_FILE = 'install-result.json'
export const MAC_SWAP_SCRIPT = 'mac-swap.sh'

/** 从安装包文件名取版本号：Simple-Music-2.6.0-arm64.dmg、Simple.Music-2.0.2-arm64.dmg、Simple-Music-2.6.0-Setup.exe */
export function installerVersion(name: string): string {
  const match = String(name || '').match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : ''
}

/** 只认安装包、下载中断留下的 .download 与校验失败挪走的 .invalid-*，其他文件一概不碰。 */
function isUpdateArtifact(name: string): boolean {
  return INSTALLER_RE.test(name) || name.endsWith(PARTIAL_SUFFIX) || name.includes('.invalid-')
}

/**
 * 选出可以删除的下载目录文件。
 * - keep 给出时（刚下载完）：除 keep、进行中的 .download 与 .invalid-* 外的安装包都删；
 * - 否则（启动时）：删 .invalid-*、中断的 .download，以及版本号不比 currentVersion 新的安装包。
 *   取不到版本号的安装包保留，宁可多占空间也不误删。
 */
export function staleUpdateFiles(names: string[], currentVersion: string, keep?: string): string[] {
  return names.filter((name) => {
    if (!isUpdateArtifact(name) || name === keep) return false
    // 校验失败挪走的文件留到下次启动再删，方便当次排查。
    if (name.includes('.invalid-')) return !keep
    if (name.endsWith(PARTIAL_SUFFIX)) return !keep
    if (keep) return true
    const version = installerVersion(name)
    return !!version && compareVersions(version, currentVersion) <= 0
  })
}

export function parseMacInstallResult(text: string): MacInstallResultRecord | null {
  try {
    const raw = JSON.parse(text) as Partial<MacInstallResultRecord>
    if (typeof raw.ok !== 'boolean' || typeof raw.code !== 'string') return null
    return { ok: raw.ok, code: raw.code, from: String(raw.from || ''), to: String(raw.to || ''), at: Number(raw.at) || 0 }
  } catch {
    return null
  }
}

function removeQuietly(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (e) {
    console.warn('[UpdateCleanup] remove failed:', target, (e as Error).message)
  }
}

function removeStale(dir: string, currentVersion: string, keep?: string): void {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of staleUpdateFiles(names, currentVersion, keep)) removeQuietly(path.join(dir, name))
}

/** 新安装包下载并校验完成后调用：同目录里其他版本的安装包已经没用了。 */
export function pruneOtherInstallers(downloadDir: string, keepFileName: string): void {
  removeStale(downloadDir, '', keepFileName)
}

/** 启动时调用：清旧安装包与 mac 替换残留，并取走上次替换的结果（读后即删，只报告一次）。 */
export function cleanupUpdateArtifacts(userDataDir: string, currentVersion: string): MacInstallResultRecord | null {
  const workDir = updateWorkDir(userDataDir)
  removeStale(updateDownloadDir(userDataDir), currentVersion)

  const resultPath = path.join(workDir, INSTALL_RESULT_FILE)
  let record: MacInstallResultRecord | null = null
  try {
    record = parseMacInstallResult(fs.readFileSync(resultPath, 'utf8'))
  } catch {
    /* 没有替换记录 */
  }
  removeQuietly(resultPath)
  removeQuietly(path.join(workDir, MAC_SWAP_SCRIPT))
  removeQuietly(path.join(workDir, 'staging'))
  // 回滚失败时备份里是旧版唯一的一份，留给用户手动找回。
  if (record?.code !== 'ROLLBACK_FAILED') removeQuietly(path.join(workDir, 'backup'))
  return record
}
