#!/usr/bin/env node
// 发版前的元数据校验：CI 发布工作流、发布 PR 检查与本地 `npm run release:check` 共用同一套规则。
//   node scripts/release/check-release.mjs              按 package.json 版本校验正式版
//   node scripts/release/check-release.mjs 2.6.2        校验指定正式版
//   node scripts/release/check-release.mjs 2.6.2-beta.3 校验预发版（只校验版本号，不要求发行说明）
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'))

const STABLE = /^\d+\.\d+\.\d+$/
const PRERELEASE = /^(\d+\.\d+\.\d+)-(beta|rc)\.\d+$/

function compareCore(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
  return 0
}

/** 发行说明须依次包含更新日志、兼容说明、验证情况，开头恰好四条不超过 72 字符的摘要。 */
export function releaseNotesErrors(text) {
  const lines = text.split(/\r?\n/)
  const firstContent = lines.find((line) => line.trim())?.trim()
  const updates = lines.findIndex((line) => line.trim() === '## 更新日志')
  const compatibility = lines.findIndex((line) => line.trim() === '## 兼容说明')
  const verification = lines.findIndex((line) => line.trim() === '## 验证情况')
  if (firstContent !== '## 更新日志' || updates < 0 || compatibility <= updates || verification <= compatibility) {
    return ['发行说明必须依次包含更新日志、兼容说明和验证情况']
  }
  const errors = []
  const details = lines.findIndex((line, index) => index > updates && index < compatibility && /^###\s+\S/.test(line.trim()))
  const summaries = lines.slice(updates + 1, details < 0 ? compatibility : details).filter((line) => line.trim())
  if (summaries.length !== 4 || summaries.some((line) => !/^-\s+\S/.test(line.trim()) || line.length > 72)) {
    errors.push('更新日志必须恰好包含四条不超过 72 字符的摘要')
  }
  if (!lines.slice(compatibility + 1, verification).some((line) => line.trim())) errors.push('兼容说明不能为空')
  if (!lines.slice(verification + 1).some((line) => line.trim())) errors.push('验证情况不能为空')
  return errors
}

export function releaseErrors(version) {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  const errors = []
  const pre = version.match(PRERELEASE)
  if (pre) {
    if (compareCore(pre[1], pkg.version) < 0) errors.push(`预发版 ${version} 的目标版本低于分支版本 ${pkg.version}`)
    return errors
  }
  if (!STABLE.test(version)) return [`版本号须为 X.Y.Z、X.Y.Z-beta.N 或 X.Y.Z-rc.N，收到 ${version}`]
  if (pkg.version !== version) errors.push(`package.json 版本 ${pkg.version} 与目标版本 ${version} 不一致`)
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    errors.push('package-lock.json 顶层及根包版本须与 package.json 一致（npm version <版本> --no-git-tag-version）')
  }
  const notes = path.join(root, `docs/release-notes-${version}.md`)
  if (!existsSync(notes)) errors.push(`缺少发行说明 docs/release-notes-${version}.md`)
  else errors.push(...releaseNotesErrors(readFileSync(notes, 'utf8')).map((message) => `release-notes-${version}.md：${message}`))
  return errors
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = (process.argv[2] || readJson('package.json').version).replace(/^v/, '')
  const errors = releaseErrors(version)
  if (errors.length) {
    for (const message of errors) console.error(`✗ ${message}`)
    process.exit(1)
  }
  console.log(`✓ v${version} 发版元数据校验通过`)
}
