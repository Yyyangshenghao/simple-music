// Exercise the actual Windows test server and stream the complete installer without running it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

if (process.platform !== 'win32') throw new Error('Windows PowerShell is required')
const kit = path.resolve('dist/update-test/kit')
const manifest = JSON.parse(fs.readFileSync(path.join(kit, 'update-manifest.json'), 'utf8'))
const port = 38928
const base = `http://127.0.0.1:${port}`
const server = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(kit, 'serve.ps1'), '-Port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
let startError
server.stdout.on('data', chunk => { output += chunk })
server.stderr.on('data', chunk => { output += chunk })
server.once('error', error => { startError = error })
try {
  let healthy = false
  for (let i = 0; i < 50; i++) {
    if (startError) throw startError
    if (server.exitCode !== null) throw new Error(output)
    try {
      const response = await fetch(base + '/health', { signal: AbortSignal.timeout(500) })
      healthy = (await response.text()) === 'simple-music-update-test-v1'
      if (healthy) break
    } catch { /* Wait for PowerShell to initialize. */ }
    await delay(100)
  }
  assert.ok(healthy, output || 'Local server did not start')
  assert.deepEqual(await (await fetch(base + '/update.json')).json(), manifest)
  for (const route of ['/README.md', '/serve.ps1', '/%2e%2e/package.json']) {
    const response = await fetch(base + route)
    assert.equal(response.status, 404, route)
    await response.arrayBuffer()
  }
  const response = await fetch(base + '/Simple-Music-2.7.0-TEST-Setup.exe')
  assert.equal(response.status, 200)
  assert.equal(Number(response.headers.get('content-length')), manifest.release.asset.size)
  const hash = crypto.createHash('sha256')
  let length = 0
  assert.ok(response.body)
  for await (const chunk of response.body) { hash.update(chunk); length += chunk.length }
  assert.equal(length, manifest.release.asset.size)
  assert.equal(hash.digest('hex'), manifest.release.asset.sha256)
  await (await fetch(base + '/stop')).text()
  for (let i = 0; i < 30 && server.exitCode === null; i++) await delay(100)
  assert.equal(server.exitCode, 0, output)
  console.log('Local update server verified: manifest, installer size/SHA-256, route isolation and shutdown. No application installed.')
} finally {
  if (server.exitCode === null) server.kill()
}
