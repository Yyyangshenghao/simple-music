import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, shell } from 'electron'
import type { PlatformAdapter, ShortcutResult } from './index'

const APP_NAME = 'Simple Music'
const APP_USER_MODEL_ID = 'com.simplemusic.desktop'
const appIconIco = () => join(app.getAppPath(), 'build', 'icon.ico')

let mousePoller: ChildProcess | null = null
let mousePollerBuffer = ''

// 通过 PowerShell GetAsyncKeyState 轮询鼠标中键（VK=4）。
export const win32Adapter: PlatformAdapter = {
  startMousePoller(onMiddleClick: () => void): void {
    if (mousePoller) return
    const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SimpleMusicMousePoll {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$prev = $false
while ($true) {
  $down = (([SimpleMusicMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0)
  if ($down -and -not $prev) {
    [Console]::Out.WriteLine("MMB")
    [Console]::Out.Flush()
  }
  $prev = $down
  Start-Sleep -Milliseconds 24
}
`
    try {
      mousePoller = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      mousePoller.stdout?.on('data', (chunk: Buffer) => {
        mousePollerBuffer += chunk.toString('utf8')
        const lines = mousePollerBuffer.split(/\r?\n/)
        mousePollerBuffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim() === 'MMB') onMiddleClick()
        }
      })
      const reset = () => {
        mousePoller = null
        mousePollerBuffer = ''
      }
      mousePoller.on('exit', reset)
      mousePoller.on('error', reset)
    } catch {
      mousePoller = null
      mousePollerBuffer = ''
    }
  },

  stopMousePoller(): void {
    if (!mousePoller) return
    try {
      mousePoller.kill()
    } catch {
      /* ignore */
    }
    mousePoller = null
    mousePollerBuffer = ''
  },

  attachWallpaperToDesktop(hwnd: string): void {
    const script = `
$ErrorActionPreference = "Stop"
if (-not ("SimpleMusicNativeWin" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SimpleMusicNativeWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
"@
}
$progman = [SimpleMusicNativeWin]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[SimpleMusicNativeWin]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null
$script:workerw = [IntPtr]::Zero
$enum = [SimpleMusicNativeWin+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$param)
  $shell = [SimpleMusicNativeWin]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shell -ne [IntPtr]::Zero) {
    $script:workerw = [SimpleMusicNativeWin]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $null)
  }
  return $true
}
[SimpleMusicNativeWin]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null
if ($script:workerw -eq [IntPtr]::Zero) { $script:workerw = $progman }
$target = [IntPtr]::new([Int64]${hwnd})
[SimpleMusicNativeWin]::SetParent($target, $script:workerw) | Out-Null
[SimpleMusicNativeWin]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013) | Out-Null
`
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 5000 },
      (error) => {
        if (error) console.warn('Wallpaper WorkerW attach failed:', error.message)
      }
    )
  },

  ensureDesktopShortcut(): ShortcutResult {
    if (process.env.SIMPLEMUSIC_NO_DESKTOP_SHORTCUT === '1') return { ok: false, skipped: true }
    if (!app.isPackaged && process.env.SIMPLEMUSIC_CREATE_DESKTOP_SHORTCUT !== '1') {
      return { ok: false, skipped: true }
    }
    try {
      const shortcutPath = join(app.getPath('desktop'), `${APP_NAME}.lnk`)
      const target = process.execPath
      const icon = existsSync(appIconIco()) ? appIconIco() : target
      const shortcut = {
        target,
        cwd: dirname(target),
        args: '',
        description: 'Simple Music desktop music player',
        icon,
        iconIndex: 0,
        appUserModelId: APP_USER_MODEL_ID
      }
      if (existsSync(shortcutPath) && shell.readShortcutLink) {
        try {
          const existing = shell.readShortcutLink(shortcutPath)
          if (existing && existing.target === target && String(existing.args ?? '') === '') {
            return { ok: true, path: shortcutPath, existing: true }
          }
        } catch {
          /* fall through to rewrite */
        }
        shell.writeShortcutLink(shortcutPath, 'replace', shortcut)
      } else {
        shell.writeShortcutLink(shortcutPath, 'create', shortcut)
      }
      return { ok: true, path: shortcutPath, created: true }
    } catch (e) {
      console.warn('Desktop shortcut creation skipped:', (e as Error).message)
      return { ok: false, error: (e as Error).message || 'DESKTOP_SHORTCUT_FAILED' }
    }
  }
}
