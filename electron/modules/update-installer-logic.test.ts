import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildMacSwapScript,
  macInstallPreflight,
  resolveMacAppBundlePath,
  shellQuote,
  type MacSwapScriptOptions,
} from './update-installer-logic'
import { parseMacInstallResult } from '../../server/lib/update-cleanup'

describe('resolveMacAppBundlePath', () => {
  it('从可执行文件路径反推带空格的 .app 根目录', () => {
    expect(resolveMacAppBundlePath('/Applications/Simple Music.app/Contents/MacOS/Simple Music')).toBe(
      '/Applications/Simple Music.app'
    )
  })

  it('不是 .app/Contents/MacOS 结构时返回 null，避免误动无关目录', () => {
    expect(resolveMacAppBundlePath('/usr/local/bin/simplemusic')).toBeNull()
    expect(resolveMacAppBundlePath('relative/Simple Music.app/Contents/MacOS/Simple Music')).toBeNull()
  })
})

describe('macInstallPreflight', () => {
  const base = { isPackaged: true, appPath: '/Applications/Simple Music.app', writable: true, sameVolume: true }

  it('条件都满足时允许原地替换', () => {
    expect(macInstallPreflight(base)).toEqual({ ok: true })
  })

  it.each([
    [{ isPackaged: false }, 'NOT_PACKAGED'],
    [{ appPath: null }, 'APP_BUNDLE_NOT_FOUND'],
    [{ appPath: '/Volumes/Simple Music 2.6.1/Simple Music.app' }, 'RUNNING_FROM_DMG'],
    [{ appPath: '/private/var/folders/x/AppTranslocation/ABC/d/Simple Music.app' }, 'APP_TRANSLOCATED'],
    [{ writable: false }, 'INSTALL_DIR_NOT_WRITABLE'],
    [{ sameVolume: false }, 'CROSS_VOLUME'],
  ])('%o 回退为打开 dmg（%s）', (patch, reason) => {
    expect(macInstallPreflight({ ...base, ...patch })).toEqual({ ok: false, reason })
  })
})

describe('shellQuote', () => {
  it('单引号转义后在 bash 里还原原文', () => {
    const value = "/tmp/it's a \"path\" $HOME"
    const out = spawnSync('/bin/bash', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' })
    expect(out.stdout).toBe(value)
  })
})

// 真实执行生成的脚本：用 stub 替掉 open，验证替换、回滚与超时三条路径落到磁盘上的结果。
describe.skipIf(process.platform === 'win32')('buildMacSwapScript 执行', () => {
  let root: string
  let opts: MacSwapScriptOptions
  let openLog: string
  let binDir: string

  const deadPid = () => {
    const child = spawnSync('/bin/sh', ['-c', 'echo $$'], { encoding: 'utf8' })
    return Number(child.stdout.trim())
  }
  const makeApp = (dir: string, marker: string) => {
    fs.mkdirSync(path.join(dir, 'Contents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'Contents', 'marker'), marker)
  }
  const marker = (dir: string) => fs.readFileSync(path.join(dir, 'Contents', 'marker'), 'utf8')
  const run = (o: MacSwapScriptOptions) => {
    const script = path.join(root, "swap's.sh")
    fs.writeFileSync(script, buildMacSwapScript(o), { mode: 0o755 })
    return spawnSync('/bin/bash', [script], { env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } })
  }
  const opened = () => (fs.existsSync(openLog) ? fs.readFileSync(openLog, 'utf8').trim().split('\n') : [])
  const result = () => parseMacInstallResult(fs.readFileSync(opts.resultPath, 'utf8'))

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sm swap '))
    binDir = path.join(root, 'bin')
    openLog = path.join(root, 'open.log')
    fs.mkdirSync(binDir)
    fs.writeFileSync(path.join(binDir, 'open'), `#!/bin/bash\necho "$1" >> ${shellQuote(openLog)}\n`, { mode: 0o755 })
    fs.mkdirSync(path.join(root, 'Applications'))
    fs.mkdirSync(path.join(root, 'updates', 'staging'), { recursive: true })
    opts = {
      pid: deadPid(),
      appPath: path.join(root, 'Applications', 'Simple Music.app'),
      stagedAppPath: path.join(root, 'updates', 'staging', 'Simple Music.app'),
      backupPath: path.join(root, 'updates', 'backup', 'Simple Music.app'),
      dmgPath: path.join(root, 'updates', 'downloads', 'Simple-Music-2.6.1-arm64.dmg'),
      logPath: path.join(root, 'updates', 'install.log'),
      resultPath: path.join(root, 'updates', 'install-result.json'),
      fromVersion: '2.6.0',
      toVersion: '2.6.1',
      waitSeconds: 0.3,
    }
    fs.mkdirSync(path.dirname(opts.backupPath), { recursive: true })
    makeApp(opts.appPath, 'old')
    makeApp(opts.stagedAppPath, 'new')
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('旧进程退出后换上新版并只重启新版', () => {
    expect(run(opts).status).toBe(0)
    expect(marker(opts.appPath)).toBe('new')
    expect(marker(opts.backupPath)).toBe('old')
    expect(fs.existsSync(opts.stagedAppPath)).toBe(false)
    expect(result()).toMatchObject({ ok: true, code: 'OK', from: '2.6.0', to: '2.6.1' })
    expect(opened()).toEqual([opts.appPath])
    expect(fs.readdirSync(path.join(root, 'Applications'))).toEqual(['Simple Music.app'])
  })

  it('暂存的新版缺失时不动旧版，重启旧版并打开 dmg', () => {
    fs.rmSync(opts.stagedAppPath, { recursive: true })
    expect(run(opts).status).toBe(1)
    expect(marker(opts.appPath)).toBe('old')
    expect(result()).toMatchObject({ ok: false, code: 'STAGED_APP_MISSING' })
    expect(opened()).toEqual([opts.appPath, opts.dmgPath])
  })

  it('新版移不到原位时回滚旧版', () => {
    // stub 掉移动新版的那一次 mv，模拟旧版已进备份、新版却换不上去。
    fs.writeFileSync(path.join(binDir, 'mv'), `#!/bin/bash
if [ "$1" = ${shellQuote(opts.stagedAppPath)} ]; then exit 1; fi
exec /bin/mv "$@"
`, { mode: 0o755 })
    expect(run(opts).status).toBe(1)
    expect(marker(opts.appPath)).toBe('old')
    expect(marker(opts.stagedAppPath)).toBe('new')
    expect(result()).toMatchObject({ ok: false, code: 'SWAP_FAILED' })
    expect(opened()).toEqual([opts.appPath, opts.dmgPath])
  })

  it('旧进程迟迟不退出时不替换、不重启，只打开 dmg', () => {
    expect(run({ ...opts, pid: process.pid }).status).toBe(1)
    expect(marker(opts.appPath)).toBe('old')
    expect(result()).toMatchObject({ ok: false, code: 'WAIT_TIMEOUT' })
    expect(opened()).toEqual([opts.dmgPath])
  })
})
