// 仅在一次性 Windows CI 环境运行真实安装/卸载，拒绝触碰已有安装。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

if (process.platform !== 'win32' || !process.env.CI) throw new Error('仅允许在一次性 Windows CI 环境验收安装器')
const guid = '471bdb5e-fa80-570a-baed-3340b3ce08c1'
for (const hive of ['HKCU', 'HKLM']) {
  const result = spawnSync('reg.exe', ['query', `${hive}\\Software\\${guid}`, '/v', 'InstallLocation'], { encoding: 'utf8' })
  if (result.status === 0) throw new Error(`检测到已有 ${hive} 安装，停止隔离验收`)
}
const installer = path.resolve('dist', fs.readdirSync('dist').find(name => /-Setup\.exe$/.test(name)) || 'missing')
assert.ok(fs.existsSync(installer), '缺少 Setup 安装包')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-music-installer-'))
const target = path.join(root, "O'Brien 中文", 'Simple Music')
const uninstall = path.join(target, 'Uninstall Simple Music.exe')
const detachedUninstall = path.join(root, 'uninstall-test.exe')
const manifest = path.join(target, '.simple-music-install.ini')
const run = (exe, args, success = true) => {
  // NSIS 的 /D= 与 _?= 必须位于最后且不加引号，由它读取后面的完整路径。
  const result = spawnSync(exe, args, { encoding: 'utf8', timeout: 120000, windowsHide: true, windowsVerbatimArguments: true, argv0: `"${exe}"` })
  if (result.error) throw result.error
  if (success) assert.equal(result.status, 0, `操作失败：${result.status} ${result.stderr}`)
  else assert.notEqual(result.status, 0, '危险操作应被拒绝')
}
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let unrelated
let locker
let succeeded = false
try {
  run(installer, ['/S', '/D=relative\\folder'], false)
  run(installer, ['/S', `/D=${process.env.WINDIR}\\SimpleMusicInstallerAudit`], false)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const parentFile = path.join(path.dirname(target), '已有文件.txt')
  fs.writeFileSync(parentFile, 'keep parent')
  // 选父目录且使用正斜杠时，程序必须实际装入 Simple Music 子目录。
  run(installer, ['/S', `/D=${path.dirname(target).replaceAll('\\', '/')}`])
  assert.equal(fs.readFileSync(parentFile, 'utf8'), 'keep parent')
  assert.ok(!fs.existsSync(path.join(path.dirname(target), 'Simple Music.exe')), '程序散落到了父目录')
  fs.copyFileSync(uninstall, detachedUninstall)
  assert.ok(fs.existsSync(manifest), '首次安装缺少归属清单')
  const original = digest(path.join(target, 'Simple Music.exe'))
  fs.writeFileSync(path.join(target, '我的文件.txt'), 'keep root')
  fs.writeFileSync(path.join(target, 'resources', '我的文件.txt'), 'keep nested')
  const originalManifest = fs.readFileSync(manifest)
  const userIcon = !originalManifest.toString('utf16le').includes('=uninstallerIcon.ico')
  if (userIcon) fs.writeFileSync(path.join(target, 'uninstallerIcon.ico'), 'user icon must survive')
  const appKey = createHash('sha256').update('resources/app.asar').digest('hex')
  fs.writeFileSync(manifest, originalManifest.toString('utf16le').split('\n').filter(line => !line.startsWith(`${appKey}=`)).join('\n'), 'utf16le')
  run(installer, ['/S', `/D=${target}`], false)
  assert.equal(digest(path.join(target, 'Simple Music.exe')), original, '归属冲突前已修改程序')
  fs.writeFileSync(manifest, originalManifest)

  // 同名前缀目录中的其他应用必须持续运行。
  const adjacent = `${target} Other`
  fs.mkdirSync(adjacent)
  const otherExe = path.join(adjacent, 'unrelated.exe')
  fs.copyFileSync(process.execPath, otherExe)
  unrelated = spawn(otherExe, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  let unrelatedError
  unrelated.once('error', error => { unrelatedError = error })
  await sleep(500)
  assert.equal(unrelatedError, undefined, '无关进程测试未成功启动')
  assert.equal(unrelated.exitCode, null, '无关进程测试提前退出')
  run(installer, ['/S', `/D=${target}`])
  await sleep(200)
  assert.equal(unrelated.exitCode, null, '安装器终止了同名前缀目录里的无关进程')
  assert.equal(fs.readFileSync(path.join(target, '我的文件.txt'), 'utf8'), 'keep root')
  assert.equal(fs.readFileSync(path.join(target, 'resources', '我的文件.txt'), 'utf8'), 'keep nested')

  // 锁住较晚处理的资源文件，让先前已备份的程序文件必须回滚。
  const ready = path.join(root, 'locked.ready')
  const ps = path.join(root, 'lock.ps1')
  fs.writeFileSync(ps, "$f=[IO.File]::Open($env:SM_LOCK_FILE,'Open','Read','Read'); try { [IO.File]::WriteAllText($env:SM_LOCK_READY,'ready'); Start-Sleep -Seconds 300 } finally { $f.Dispose() }")
  locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps], {
    stdio: 'ignore', windowsHide: true,
    env: { ...process.env, SM_LOCK_FILE: path.join(target, 'resources/app.asar'), SM_LOCK_READY: ready }
  })
  for (let i = 0; i < 100 && !fs.existsSync(ready); i++) await sleep(100)
  assert.ok(fs.existsSync(ready), '无法建立文件占用用例')
  run(installer, ['/S', `/D=${target}`], false)
  assert.equal(digest(path.join(target, 'Simple Music.exe')), original, '失败后旧程序未恢复')
  assert.ok(fs.existsSync(manifest), '失败后归属清单未恢复')
  locker.kill()
  await new Promise(resolve => locker.once('exit', resolve))
  locker = null

  // resources 联接到根目录外，卸载必须在任何删除之前失败。
  const savedResources = path.join(root, 'saved-resources')
  const external = path.join(root, 'external')
  fs.renameSync(path.join(target, 'resources'), savedResources)
  fs.mkdirSync(external)
  fs.writeFileSync(path.join(external, 'app.asar'), 'external user data')
  fs.symlinkSync(external, path.join(target, 'resources'), 'junction')
  run(detachedUninstall, ['/S', `_?=${target}`], false)
  assert.equal(fs.readFileSync(path.join(external, 'app.asar'), 'utf8'), 'external user data')
  assert.ok(fs.existsSync(path.join(target, 'Simple Music.exe')), '联接检查失败前已删除部分程序')
  fs.unlinkSync(path.join(target, 'resources'))
  fs.renameSync(savedResources, path.join(target, 'resources'))

  run(detachedUninstall, ['/S', `_?=${target}`])
  assert.equal(fs.readFileSync(path.join(target, '我的文件.txt'), 'utf8'), 'keep root')
  assert.equal(fs.readFileSync(path.join(target, 'resources', '我的文件.txt'), 'utf8'), 'keep nested')
  assert.ok(!fs.existsSync(path.join(target, 'Simple Music.exe')), '卸载未清理程序文件')
  if (userIcon) assert.equal(fs.readFileSync(path.join(target, 'uninstallerIcon.ico'), 'utf8'), 'user icon must survive')

  // 模拟没有归属清单的旧安装：其卸载入口是一个不能接受NSIS参数的exe，绝不能被执行。
  fs.copyFileSync(process.execPath, uninstall)
  fs.writeFileSync(path.join(target, 'Simple Music.exe'), 'legacy program must survive')
  run('reg.exe', ['add', `HKCU\\Software\\${guid}`, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', `"${target}"`, '/f'])
  run(installer, ['/S', `/D=${target}`])
  const registered = spawnSync('reg.exe', ['query', `HKCU\\Software\\${guid}`, '/v', 'InstallLocation'], { encoding: 'utf8' })
  assert.equal(registered.status, 0)
  const migrated = registered.stdout.split(/\s+REG_SZ\s+/).at(-1).trim()
  assert.notEqual(migrated.toLowerCase(), target.toLowerCase(), '旧混用目录未隔离迁移')
  assert.ok(migrated.toLowerCase().startsWith((target + path.sep).toLowerCase()))
  assert.ok(fs.existsSync(path.join(migrated, '.simple-music-install.ini')))
  assert.equal(fs.readFileSync(path.join(target, 'Simple Music.exe'), 'utf8'), 'legacy program must survive')
  assert.equal(fs.readFileSync(path.join(target, '我的文件.txt'), 'utf8'), 'keep root')
  assert.equal(digest(uninstall), digest(path.join(migrated, 'Uninstall Simple Music.exe')), '旧卸载入口未替换')
  fs.copyFileSync(path.join(migrated, 'Uninstall Simple Music.exe'), detachedUninstall)
  run(detachedUninstall, ['/S', `_?=${migrated}`])
  assert.equal(fs.readFileSync(path.join(target, 'Simple Music.exe'), 'utf8'), 'legacy program must survive')
  succeeded = true
  console.log('Windows 路径校验、安装重装、锁文件回滚、目录联接、旧版迁移与卸载验收通过')
} finally {
  unrelated?.kill()
  locker?.kill()
  // 只清理本脚本创建的隔离临时目录；失败时保留现场供CI日志排查。
  if (succeeded) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  else console.error(`Windows 安装验收失败，现场保留在 ${root}`)
}
