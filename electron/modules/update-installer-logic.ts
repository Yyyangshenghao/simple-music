// 更新安装流程中不依赖 Electron API 的纯逻辑，独立于 update-installer.ts 以便单测。
//
// macOS 原地替换的约束：应用只有 adhoc 签名，用不了 Squirrel.Mac。旧方案把 .app.new 暂存在
// /Applications 旁边，脚本中断就留下孤儿目录（f347fde 撤掉）。现在新版先在 userData 的
// updates/staging 里解出并核对，/Applications 里只发生两次同卷 rename（旧版移进备份、新版移到原位），
// 任一步失败回滚并打开 dmg 交给用户手动安装。

export type MacPreflightReason =
  | 'NOT_PACKAGED'
  | 'APP_BUNDLE_NOT_FOUND'
  | 'RUNNING_FROM_DMG'
  | 'APP_TRANSLOCATED'
  | 'INSTALL_DIR_NOT_WRITABLE'
  | 'CROSS_VOLUME'

export interface MacPreflightInput {
  isPackaged: boolean
  appPath: string | null
  /** 安装目录（.app 的父目录）与 .app 本身均可写 */
  writable: boolean
  /** 暂存目录与安装目录在同一卷，rename 才是原子的 */
  sameVolume: boolean
}

export type MacPreflightResult = { ok: true } | { ok: false; reason: MacPreflightReason }

export interface MacSwapScriptOptions {
  pid: number
  appPath: string
  stagedAppPath: string
  backupPath: string
  dmgPath: string
  logPath: string
  resultPath: string
  fromVersion: string
  toVersion: string
  /** 等旧进程退出的上限；退出流程里专用浏览器清理最多约 8 秒，留足余量 */
  waitSeconds?: number
}

/** 从 app.getPath('exe') 反推 .app bundle 根目录：
 *  .../Simple Music.app/Contents/MacOS/Simple Music -> .../Simple Music.app */
export function resolveMacAppBundlePath(exePath: string): string | null {
  const match = String(exePath || '').match(/^(\/.*\.app)\/Contents\/MacOS\/[^/]+$/)
  return match ? match[1] : null
}

/** 原地替换前的环境判断；任何一项不满足都回退为打开 dmg，不做半截替换。 */
export function macInstallPreflight(input: MacPreflightInput): MacPreflightResult {
  if (!input.isPackaged) return { ok: false, reason: 'NOT_PACKAGED' }
  if (!input.appPath) return { ok: false, reason: 'APP_BUNDLE_NOT_FOUND' }
  if (input.appPath.startsWith('/Volumes/')) return { ok: false, reason: 'RUNNING_FROM_DMG' }
  if (input.appPath.includes('/AppTranslocation/')) return { ok: false, reason: 'APP_TRANSLOCATED' }
  if (!input.writable) return { ok: false, reason: 'INSTALL_DIR_NOT_WRITABLE' }
  if (!input.sameVolume) return { ok: false, reason: 'CROSS_VOLUME' }
  return { ok: true }
}

/** 单引号包裹的 shell 字面量；路径里常有空格（"Simple Music.app"），也可能带引号。 */
export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** 生成"等旧进程退出 → 同卷 rename 替换 → 失败回滚 → 重启"的 bash 脚本。
 *  脚本以 detached 子进程运行，主进程退出后继续完成替换；新版已在暂存目录核对过，
 *  这里只剩两次 mv。任何失败都回到旧版本并打开 dmg，不能让用户落到"新旧版本都不在"。 */
export function buildMacSwapScript(options: MacSwapScriptOptions): string {
  const q = shellQuote
  const ticks = Math.max(1, Math.round((options.waitSeconds ?? 60) * 10))
  return `#!/bin/bash
LOG=${q(options.logPath)}
exec >>"$LOG" 2>&1
PID=${Math.trunc(options.pid)}
APP=${q(options.appPath)}
NEW=${q(options.stagedAppPath)}
BACKUP=${q(options.backupPath)}
DMG=${q(options.dmgPath)}
RESULT=${q(options.resultPath)}
FROM=${q(options.fromVersion)}
TO=${q(options.toVersion)}

echo "[$(date)] swap $FROM -> $TO"
result() {
  printf '{"ok":%s,"code":"%s","from":"%s","to":"%s","at":%s}\\n' "$1" "$2" "$FROM" "$TO" "$(date +%s)000" > "$RESULT.tmp" && mv -f "$RESULT.tmp" "$RESULT"
}
fail() {
  echo "FAIL $1"
  result false "$1"
  open "$APP" 2>/dev/null
  open "$DMG" 2>/dev/null
  exit 1
}

i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge ${ticks} ]; then
    # 旧版本没退出：不能动它，也不能再拉起一份（会撞单实例锁），只交出安装包。
    echo "FAIL WAIT_TIMEOUT"
    result false WAIT_TIMEOUT
    open "$DMG" 2>/dev/null
    exit 1
  fi
  sleep 0.1
done

[ -d "$NEW" ] || fail STAGED_APP_MISSING
rm -rf "$BACKUP"
mv "$APP" "$BACKUP" || fail BACKUP_MOVE_FAILED
if ! mv "$NEW" "$APP"; then
  echo "SWAP_FAILED_ROLLBACK"
  if ! mv "$BACKUP" "$APP"; then
    echo "FAIL ROLLBACK_FAILED backup kept at $BACKUP"
    result false ROLLBACK_FAILED
    open "$DMG" 2>/dev/null
    exit 1
  fi
  fail SWAP_FAILED
fi

result true OK
echo "OK"
open "$APP"
`
}
