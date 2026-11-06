import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import asar from '@electron/asar'

const root = path.resolve('dist/update-test')
const templates = path.dirname(fileURLToPath(import.meta.url))
const metadata = JSON.parse(fs.readFileSync('package.json', 'utf8'))
fs.mkdirSync(root, { recursive: true })
if (process.argv.includes('--config')) {
  const build = structuredClone(metadata.build)
  const mapFiles = list => list.map(item => item === 'out/**/*'
    ? { from: 'dist/update-test/out', to: 'out', filter: ['**/*'] }
    : item)
  build.files = mapFiles(build.files)
  build.win.files = mapFiles(build.win.files)
  build.directories.output = 'dist/update-test/build'
  build.extraMetadata = { ...build.extraMetadata, version: '2.7.0' }
  build.electronDist = 'node_modules/electron/dist'
  build.nsis.artifactName = 'Simple-Music-2.7.0-TEST-Setup.exe'
  fs.writeFileSync(path.join(root, 'builder.json'), JSON.stringify(build, null, 2))
  console.log('Created test-only build configuration; repository package.json unchanged.')
} else if (process.argv.includes('--assemble')) {
  const artifact = path.join(root, 'build/Simple-Music-2.7.0-TEST-Setup.exe')
  const packed = path.join(root, 'build/win-unpacked/resources/app.asar')
  assert.equal(JSON.parse(asar.extractFile(packed, 'package.json').toString()).version, '2.7.0')
  const kit = path.join(root, 'kit')
  fs.mkdirSync(kit, { recursive: true })
  const oldName = 'Simple-Music-2.6.2-ORIGINAL-Setup.exe'
  const newName = 'Simple-Music-2.7.0-TEST-Setup.exe'
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const oldSource = path.join(root, oldName)
  assert.equal(digest(oldSource), '652b36131458def1d42de68a70cfdc7bbd25a14ba621972afddbfe21187ecb87')
  fs.copyFileSync(oldSource, path.join(kit, oldName))
  fs.copyFileSync(artifact, path.join(kit, newName))
  for (const name of ['serve.ps1', 'start-update-test.ps1', 'README.md']) {
    fs.copyFileSync(path.join(templates, name), path.join(kit, name))
  }
  const url = `http://127.0.0.1:38927/${newName}`
  const manifest = {
    version: '2.7.0',
    downloadUrl: url,
    release: {
      name: 'Simple Music 2.7.0 本地更新测试',
      summary: '仅验证安装与更新，不是公开发布。',
      notes: ['TEST 本地安装包；完成后请核对设置、文件保留和卸载。'],
      asset: { name: newName, size: fs.statSync(artifact).size, sha256: digest(artifact), downloadUrl: url }
    }
  }
  fs.writeFileSync(path.join(kit, 'update-manifest.json'), JSON.stringify(manifest, null, 2))
  fs.writeFileSync(path.join(kit, '启动应用内更新测试.cmd'), '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-update-test.ps1"\r\npause\r\n')
  fs.writeFileSync(path.join(kit, '停止测试更新服务.cmd'), '@echo off\r\npowershell.exe -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:38927/stop -UseBasicParsing -TimeoutSec 3 | Out-Null; Write-Host Stopped } catch { Write-Host Already-stopped-or-unavailable }"\r\npause\r\n')
  fs.writeFileSync(path.join(kit, 'SHA256SUMS.txt'), [oldName, newName].map(name => `${digest(path.join(kit, name))}  ${name}`).join('\r\n') + '\r\n')
  console.log(`Test kit ready: ${kit}`)
} else {
  throw new Error('Use --config or --assemble')
}
