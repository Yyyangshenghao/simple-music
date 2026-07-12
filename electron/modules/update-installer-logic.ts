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
DMG="${dmgPath}"
APP_PATH="${appPath}"
MOUNT_DIR=$(mktemp -d)
cleanup() { hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true; rmdir "$MOUNT_DIR" 2>/dev/null || true; }
trap cleanup EXIT

fail() {
  echo "$1"
  open "$APP_PATH" 2>/dev/null || true
  exit 1
}

hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT_DIR" || fail "HDIUTIL_ATTACH_FAILED"

SRC_APP=$(find "$MOUNT_DIR" -maxdepth 1 -name "*.app" | head -n1)
if [ -z "$SRC_APP" ]; then fail "SRC_APP_NOT_FOUND"; fi

NEW_APP="$APP_PATH.new"
rm -rf "$NEW_APP"
ditto "$SRC_APP" "$NEW_APP" || fail "DITTO_FAILED"
xattr -dr com.apple.quarantine "$NEW_APP" 2>/dev/null || true

OLD_BACKUP="$APP_PATH.old"
rm -rf "$OLD_BACKUP"
mv "$APP_PATH" "$OLD_BACKUP" || fail "BACKUP_MOVE_FAILED"

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
