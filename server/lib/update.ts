// ====================================================================
//  更新检查 / 下载 / 补丁 辅助库（自参考项目 server.js 移植）
//  - GitHub Release / latest.yml / manifest 检查
//  - 国内镜像加速线路
//  - 下载任务队列 + 进度 / 测速 / digest 校验
//  - 补丁热更新（新架构暂不支持，详见下方 TODO）
// ====================================================================
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import type { ServerContext } from '../types'
// 直接读取新项目自身的 package.json；通过 unknown 转型以容忍缺失的 simplemusic 字段。
import pkgJson from '../../package.json' with { type: 'json' }

// ---------- package.json / 更新配置 ----------
interface PackageRepository {
  url?: string
}
interface PackageUpdateField {
  provider?: string
  owner?: string
  repo?: string
  repository?: string
  github?: string
  preview?: boolean
  preferMirrors?: boolean
  mirrors?: unknown
  downloadMirrors?: unknown
}
interface PackageJson {
  name?: string
  productName?: string
  version?: string
  repository?: PackageRepository | string
  simplemusic?: { update?: PackageUpdateField }
}

const APP_PACKAGE = pkgJson as unknown as PackageJson
const APP_VERSION = process.env.SIMPLEMUSIC_VERSION || APP_PACKAGE.version || '0.9.11'

export interface UpdateConfig {
  provider: string
  owner: string
  repo: string
  configured: boolean
  preview: boolean
  preferMirrors: boolean
  mirrors: string[]
  manifest: string
}

function parseGitHubRepository(input: unknown): { owner: string; repo: string } | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  const direct = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (direct) return { owner: direct[1], repo: direct[2].replace(/\.git$/i, '') }
  const github = raw.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?].*)?$/i)
  if (github) return { owner: github[1], repo: github[2].replace(/\.git$/i, '') }
  return null
}

function parseUpdateMirrorList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v))
  return String(value || '').split(/[\n,;]/)
}

function readUpdateMirrors(local: PackageUpdateField): string[] {
  const envMirrors = process.env.SIMPLEMUSIC_UPDATE_MIRRORS || process.env.SIMPLEMUSIC_UPDATE_MIRROR || ''
  const raw = envMirrors
    ? parseUpdateMirrorList(envMirrors)
    : parseUpdateMirrorList(local.mirrors || local.downloadMirrors || [])
  const seen = new Set<string>()
  const mirrors: string[] = []
  raw.forEach((item) => {
    const u = String(item || '').trim()
    if (!/^https?:\/\//i.test(u)) return
    const key = u.replace(/\/+$/, '').toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    mirrors.push(u)
  })
  return mirrors.slice(0, 6)
}

function readUpdateConfig(pkg: PackageJson): UpdateConfig {
  const local = (pkg && pkg.simplemusic && pkg.simplemusic.update) || {}
  const repoFromPkg =
    pkg && pkg.repository
      ? typeof pkg.repository === 'string'
        ? pkg.repository
        : pkg.repository.url
      : ''
  const repoHint =
    process.env.SIMPLEMUSIC_UPDATE_REPOSITORY ||
    process.env.GITHUB_REPOSITORY ||
    local.repository ||
    local.github ||
    repoFromPkg ||
    ''
  const parsed = parseGitHubRepository(repoHint)
  const owner = process.env.SIMPLEMUSIC_UPDATE_OWNER || local.owner || parsed?.owner || ''
  const repo = process.env.SIMPLEMUSIC_UPDATE_REPO || local.repo || parsed?.repo || ''
  return {
    provider: local.provider || 'github',
    owner,
    repo,
    configured: !!(owner && repo),
    preview: local.preview !== false,
    preferMirrors: local.preferMirrors !== false,
    mirrors: readUpdateMirrors(local),
    manifest:
      process.env.SIMPLEMUSIC_UPDATE_MANIFEST ||
      process.env.SIMPLEMUSIC_UPDATE_MANIFEST_URL ||
      process.env.SIMPLEMUSIC_UPDATE_MANIFEST_FILE ||
      '',
  }
}

export const UPDATE_CONFIG: UpdateConfig = readUpdateConfig(APP_PACKAGE)

export const APP_INFO = {
  name: APP_PACKAGE.name || 'simplemusic',
  productName: APP_PACKAGE.productName || 'SimpleMusic',
  version: APP_VERSION,
}

const PATCH_MAX_BYTES = 12 * 1024 * 1024
const UPDATE_FALLBACK_NOTES = ['电影镜头节奏更松', '音源失败自动换源', '右上角更新提示']

// 下载目录落到 ctx.userDataDir 下，不硬编码绝对路径。
function updateWorkDir(ctx: ServerContext): string {
  return process.env.SIMPLEMUSIC_UPDATE_DIR || path.join(ctx.userDataDir, 'updates')
}
function updateDownloadDir(ctx: ServerContext): string {
  return process.env.SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR || path.join(updateWorkDir(ctx), 'downloads')
}

// ---------- 类型定义 ----------
interface DigestInfo {
  sha256: string
  sha512: string
}
export interface DownloadCandidate {
  url: string
  label: string
  mirrored: boolean
}
export interface UpdateAsset {
  name: string
  size: number
  contentType: string
  downloadUrl: string
  downloadUrls: string[]
  sha256: string
  sha512: string
}
export interface PatchAsset extends UpdateAsset {
  from?: string
  to?: string
}
export interface UpdateRelease {
  tagName: string
  name: string
  version: string
  publishedAt?: string
  htmlUrl: string
  downloadUrl: string
  asset?: UpdateAsset | null
  patch?: PatchAsset | null
  patchAvailable?: boolean
  summary: string
  notes: string[]
}
export interface UpdateInfo {
  configured: boolean
  preview: boolean
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string
  release: UpdateRelease
  source?: string
  reason?: string
}

interface FailedAttempt {
  source: string
  reason: string
  detail: string
}
type JobStatus = 'queued' | 'downloading' | 'ready' | 'error'
type JobMode = 'installer' | 'patch'
interface UpdateJob {
  id: string
  status: JobStatus
  progress: number
  received: number
  total: number
  speedBps: number
  etaSeconds: number
  sourceLabel: string
  attempt: number
  attempts: number
  mode: JobMode
  message: string
  restartRequired: boolean
  cached: boolean
  fileName: string
  filePath: string
  version: string
  downloadUrl: string
  downloadCandidates: DownloadCandidate[]
  downloadDir: string
  expectedSize: number
  sha256: string
  sha512: string
  releaseUrl: string
  error: string
  errorReason: string
  errorDetail: string
  failedAttempts: FailedAttempt[]
  changedFiles?: string[]
  createdAt: number
  updatedAt: number
}

export interface PublicUpdateJob {
  ok: boolean
  id: string
  status: JobStatus
  progress: number
  received: number
  total: number
  speedBps: number
  etaSeconds: number
  sourceLabel: string
  attempt: number
  attempts: number
  mode: JobMode
  message: string
  restartRequired: boolean
  cached: boolean
  fileName: string
  filePath: string
  version: string
  releaseUrl: string
  error: string
  errorReason: string
  errorDetail: string
  failedAttempts: FailedAttempt[]
  createdAt: number
  updatedAt: number
}
export interface JobError {
  ok: false
  error: string
}
export type JobResult = PublicUpdateJob | JobError

// ---------- 任务表 ----------
export const updateDownloadJobs = new Map<string, UpdateJob>()

// ---------- digest / 镜像 / 候选线路 ----------
function normalizeDigest(value: unknown, algorithm: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const prefix = new RegExp('^' + algorithm + ':', 'i')
  return raw
    .replace(prefix, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}
function assetDigestInfo(asset: Record<string, unknown> | null | undefined): DigestInfo {
  const digest = String((asset && asset.digest) || '').trim()
  return {
    sha256: normalizeDigest(
      (asset && (asset.sha256 as string)) || (/^sha256:/i.test(digest) ? digest : ''),
      'sha256'
    ).toLowerCase(),
    sha512: normalizeDigest((asset && (asset.sha512 as string)) || (/^sha512:/i.test(digest) ? digest : ''), 'sha512'),
  }
}
function buildMirrorUrl(originalUrl: string, mirror: string): string {
  const source = String(originalUrl || '').trim()
  const base = String(mirror || '').trim()
  if (!/^https?:\/\//i.test(source) || !/^https?:\/\//i.test(base)) return ''
  if (base.includes('{encodedUrl}')) return base.replace(/\{encodedUrl\}/g, encodeURIComponent(source))
  if (base.includes('{url}')) return base.replace(/\{url\}/g, source)
  return base.replace(/\/+$/, '/') + source
}
function uniqueDownloadCandidates(urls: string | string[], opts?: { useMirrors?: boolean }): DownloadCandidate[] {
  const options = opts || {}
  const directUrls = (Array.isArray(urls) ? urls : [urls])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u))
  const directSet = new Set(directUrls.map((u) => u.toLowerCase()))
  const mirrors = options.useMirrors === false ? [] : UPDATE_CONFIG.mirrors || []
  const mirrored: DownloadCandidate[] = []
  directUrls.forEach((source) => {
    mirrors.forEach((mirror, index) => {
      const u = buildMirrorUrl(source, mirror)
      if (u) mirrored.push({ url: u, label: '国内加速线路 ' + (index + 1), mirrored: true })
    })
  })
  const direct: DownloadCandidate[] = directUrls.map((u) => ({
    url: u,
    label: directSet.has(u.toLowerCase()) ? 'GitHub 直连' : '下载线路',
    mirrored: false,
  }))
  const ordered = UPDATE_CONFIG.preferMirrors === false ? direct.concat(mirrored) : mirrored.concat(direct)
  const seen = new Set<string>()
  return ordered.filter((item) => {
    const key = item.url.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function publicDownloadUrls(candidates: DownloadCandidate[]): string[] {
  return (Array.isArray(candidates) ? candidates : []).map((item) => item && item.url).filter(Boolean)
}

// ---------- 版本 / release notes ----------
function normalizeVersion(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/[+].*$/, '')
    .replace(/-.+$/, '')
}
function compareVersions(a: unknown, b: unknown): number {
  const aa = normalizeVersion(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const bb = normalizeVersion(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const len = Math.max(aa.length, bb.length, 3)
  for (let i = 0; i < len; i++) {
    const left = aa[i] || 0
    const right = bb[i] || 0
    if (left > right) return 1
    if (left < right) return -1
  }
  return 0
}
function cleanReleaseLine(line: unknown): string {
  return String(line || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
}
function extractReleaseNotes(body: unknown): string[] {
  const notes: string[] = []
  String(body || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const text = cleanReleaseLine(line)
      if (!text) return
      if (/^(what'?s changed|changes|changelog|full changelog|更新日志)$/i.test(text)) return
      if (/^https?:\/\//i.test(text)) return
      if (text.length > 72) return
      notes.push(text)
    })
  return notes.slice(0, 4)
}

// ---------- GitHub release 资源选择 ----------
interface GithubAsset {
  name?: string
  size?: number
  content_type?: string
  browser_download_url?: string
  digest?: string
  sha256?: string
  sha512?: string
}
function asGithubAssets(value: unknown): GithubAsset[] {
  return Array.isArray(value) ? (value as GithubAsset[]) : []
}
function pickReleaseAsset(assets: unknown): UpdateAsset | null {
  const list = asGithubAssets(assets)
  const preferred =
    list.find((a) => /\.(exe|msi)$/i.test((a && a.name) || '')) ||
    list.find((a) => /\.(zip|7z)$/i.test((a && a.name) || '')) ||
    list[0]
  if (!preferred) return null
  const digest = assetDigestInfo(preferred as unknown as Record<string, unknown>)
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '')
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  }
}
function patchAssetVersions(name: unknown): string[] {
  const matches = String(name || '').match(/\d+(?:[._-]\d+){1,3}/g) || []
  return matches.map((item) => normalizeVersion(item.replace(/[._-]/g, '.'))).filter(Boolean)
}
function pickPatchAsset(assets: unknown, currentVersion: string, latestVersion: string): PatchAsset | null {
  const list = asGithubAssets(assets)
  const current = normalizeVersion(currentVersion || APP_VERSION)
  const latest = normalizeVersion(latestVersion || '')
  const preferred =
    list.find((a) => {
      const name = String((a && a.name) || '')
      if (!/\.(patch\.json|patch|json)$/i.test(name)) return false
      const versions = patchAssetVersions(name)
      if (latest) return versions[0] === current && versions[versions.length - 1] === latest
      return versions[0] === current && name.toLowerCase().includes('patch')
    }) ||
    list.find((a) => {
      const name = String((a && a.name) || '')
      if (!/\.(patch\.json|patch|json)$/i.test(name)) return false
      const versions = patchAssetVersions(name)
      return versions[0] === current && name.toLowerCase().includes('patch')
    }) ||
    list.find((a) => /\.(patch\.json|patch)$/i.test((a && a.name) || ''))
  if (!preferred) return null
  const digest = assetDigestInfo(preferred as unknown as Record<string, unknown>)
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '')
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  }
}
function updateAssetNameFromUrl(value: unknown): string {
  try {
    const u = new URL(String(value || ''))
    const base = path.basename(decodeURIComponent(u.pathname || ''))
    if (base) return base
  } catch {
    /* ignore */
  }
  return path.basename(String(value || '').split('?')[0]) || ''
}

// ---------- manifest 解析 ----------
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
function normalizeManifestUpdateInfo(input: unknown): UpdateInfo {
  const data = asRecord(input)
  const release = asRecord(data.release)
  const asset = asRecord(release.asset || data.asset)
  const latestVersion =
    normalizeVersion(
      data.latestVersion ||
        data.version ||
        release.version ||
        release.tagName ||
        release.tag_name ||
        release.name ||
        APP_VERSION
    ) || APP_VERSION
  const downloadUrl = String(
    release.downloadUrl || data.downloadUrl || asset.downloadUrl || asset.browser_download_url || ''
  )
  const patch = release.patch || data.patch || null
  const patchRec = asRecord(patch)
  const assetUrls = [downloadUrl].concat(Array.isArray(asset.downloadUrls) ? (asset.downloadUrls as string[]) : [])
  const patchUrls = patch
    ? [String(patchRec.downloadUrl || '')].concat(
        Array.isArray(patchRec.downloadUrls) ? (patchRec.downloadUrls as string[]) : []
      )
    : []
  const patchInfo: PatchAsset | null =
    patch && patchRec.downloadUrl
      ? {
          name:
            String(patchRec.name || '') ||
            updateAssetNameFromUrl(patchRec.downloadUrl) ||
            `SimpleMusic-${APP_VERSION}→${latestVersion}.patch.json`,
          size: Number(patchRec.size || 0) || 0,
          contentType: String(patchRec.contentType || patchRec.content_type || 'application/json'),
          downloadUrl: String(patchRec.downloadUrl),
          downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(patchUrls)),
          from: normalizeVersion(patchRec.from || APP_VERSION),
          to: normalizeVersion(patchRec.to || latestVersion),
          sha256: normalizeDigest(patchRec.sha256 || '', 'sha256').toLowerCase(),
          sha512: normalizeDigest(patchRec.sha512 || '', 'sha512'),
        }
      : null
  const releaseNotes = Array.isArray(release.notes) ? (release.notes as unknown[]) : []
  const notes =
    releaseNotes.length > 0
      ? releaseNotes.slice(0, 4).map(cleanReleaseLine).filter(Boolean)
      : extractReleaseNotes(release.body || data.body).length
        ? extractReleaseNotes(release.body || data.body)
        : UPDATE_FALLBACK_NOTES
  const assetInfo: UpdateAsset | null = downloadUrl
    ? {
        name: String(asset.name || '') || updateAssetNameFromUrl(downloadUrl) || `SimpleMusic-${latestVersion}-Setup.exe`,
        size: Number(asset.size || 0) || 0,
        contentType: String(asset.contentType || asset.content_type || ''),
        downloadUrl,
        downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(assetUrls)),
        sha256: normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase(),
        sha512: normalizeDigest(asset.sha512 || release.sha512 || data.sha512 || '', 'sha512'),
      }
    : null
  return {
    configured: true,
    preview: false,
    updateAvailable:
      data.updateAvailable != null ? !!data.updateAvailable : compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: String(release.tagName || release.tag_name || data.tagName || 'v' + latestVersion),
      name: String(release.name || data.name || 'Simple Music v' + latestVersion),
      version: latestVersion,
      publishedAt: String(release.publishedAt || release.published_at || data.publishedAt || ''),
      htmlUrl: String(release.htmlUrl || release.html_url || data.htmlUrl || ''),
      downloadUrl,
      asset: assetInfo,
      patch: patchInfo,
      patchAvailable: !!(patchInfo && patchInfo.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
      summary: String(release.summary || data.summary || notes[0] || '发现新版本，建议更新。'),
      notes,
    },
    source: 'manifest',
  }
}
async function readUpdateManifest(ref: string): Promise<unknown> {
  const value = String(ref || '').trim()
  if (!value) throw new Error('UPDATE_MANIFEST_MISSING')
  if (/^https?:\/\//i.test(value)) {
    const resp = await fetch(value, { headers: { 'User-Agent': `SimpleMusic/${APP_VERSION}` } })
    if (!resp.ok) throw new Error('Update manifest ' + resp.status)
    return resp.json()
  }
  const file = /^file:/i.test(value) ? fileURLToPath(value) : path.resolve(value)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
async function fetchManifestUpdateInfo(ref: string): Promise<UpdateInfo> {
  try {
    const data = await readUpdateManifest(ref)
    return normalizeManifestUpdateInfo(data)
  } catch (err) {
    return localUpdateFallback(errMessage(err) || 'Update manifest failed', { configured: true })
  }
}

// ---------- 本地回退 / 错误分类 ----------
export function localUpdateFallback(reason?: string, opts?: { configured?: boolean }): UpdateInfo {
  const options = opts || {}
  const configured = !!(options.configured != null ? options.configured : false)
  return {
    configured,
    preview: UPDATE_CONFIG.preview,
    updateAvailable: false,
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    release: {
      tagName: 'v' + APP_VERSION,
      name: 'Simple Music v' + APP_VERSION,
      version: APP_VERSION,
      htmlUrl: '',
      downloadUrl: '',
      summary: '当前版本，更新检测已就绪。',
      notes: UPDATE_FALLBACK_NOTES,
    },
    reason: reason || '',
  }
}

class UpdateError extends Error {
  code: string
  constructor(code: string, message?: string, cause?: unknown) {
    super(message || code)
    this.code = code
    if (cause) this.cause = cause
  }
}
function updateError(code: string, message?: string, cause?: unknown): UpdateError {
  return new UpdateError(code, message, cause)
}
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err || '')
}
function errCode(err: unknown): string {
  return err instanceof UpdateError ? err.code : ''
}
interface ClassifiedError {
  code: string
  reason: string
  detail: string
}
function classifyUpdateError(err: unknown): ClassifiedError {
  const code = String(errCode(err) || '').trim()
  const message = errMessage(err).trim()
  const detail = message || code || '未知错误'
  const combined = code + ' ' + message
  if (/HASH|DIGEST|CHECKSUM/i.test(combined)) {
    return { code: code || 'UPDATE_HASH_MISMATCH', reason: '文件校验失败，可能是线路缓存异常，已拦截该安装包。', detail }
  }
  if (/SIZE_MISMATCH|content length/i.test(combined)) {
    return {
      code: code || 'UPDATE_SIZE_MISMATCH',
      reason: '下载文件大小不一致，可能是网络中断或线路缓存不完整。',
      detail,
    }
  }
  if (/AbortError|TIMEOUT|ETIMEDOUT|timeout/i.test(combined)) {
    return { code: code || 'UPDATE_TIMEOUT', reason: '连接超时，当前网络到更新线路不稳定。', detail }
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS|fetch failed|getaddrinfo/i.test(combined)) {
    return { code: code || 'UPDATE_DNS_FAILED', reason: '域名解析失败，可能是当前网络无法连接该更新线路。', detail }
  }
  if (/ECONNRESET|ECONNREFUSED|socket|network/i.test(combined)) {
    return { code: code || 'UPDATE_NETWORK_FAILED', reason: '网络连接被中断，已尝试切换更新线路。', detail }
  }
  const http = message.match(/\bHTTP[_\s-]?(\d{3})\b/i) || message.match(/\b(\d{3})\b/)
  if (http) {
    const status = Number(http[1])
    if (status === 403) return { code: code || 'UPDATE_HTTP_403', reason: '更新线路返回 403，可能被限流或拦截。', detail }
    if (status === 404)
      return { code: code || 'UPDATE_HTTP_404', reason: '更新文件不存在，可能 release 资源还没有同步完成。', detail }
    if (status >= 500) return { code: code || 'UPDATE_HTTP_5XX', reason: '更新线路服务器异常，请稍后重试。', detail }
    return { code: code || 'UPDATE_HTTP_' + status, reason: '更新线路返回 HTTP ' + status + '。', detail }
  }
  return { code: code || 'UPDATE_FAILED', reason: '更新失败：' + detail, detail }
}

// ---------- HTTP 工具 ----------
async function fetchWithTimeout(url: string, opts?: RequestInit, timeoutMs?: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000)
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: controller.signal }))
  } finally {
    clearTimeout(timer)
  }
}
async function fetchTextFromCandidates(
  candidates: DownloadCandidate[],
  timeoutMs?: number
): Promise<{ text: string; candidate: DownloadCandidate }> {
  const list = Array.isArray(candidates) && candidates.length ? candidates : []
  const failures: string[] = []
  for (let i = 0; i < list.length; i++) {
    const candidate = list[i]
    try {
      const resp = await fetchWithTimeout(
        candidate.url,
        { headers: { 'User-Agent': `SimpleMusic/${APP_VERSION}` } },
        timeoutMs || 6500
      )
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status)
      return { text: await resp.text(), candidate }
    } catch (err) {
      const info = classifyUpdateError(err)
      failures.push(candidate.label + ': ' + info.reason)
    }
  }
  throw updateError('UPDATE_ALL_LINES_FAILED', failures.join('；') || 'All update lines failed')
}

// ---------- latest.yml 备用线路 ----------
function yamlScalar(text: string, key: string): string {
  const pattern = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.+?)\\s*$', 'm')
  const match = String(text || '').match(pattern)
  if (!match) return ''
  return match[1].trim().replace(/^['"]|['"]$/g, '')
}
function githubReleaseDownloadUrl(version: string, fileName: string): string {
  const tag = 'v' + normalizeVersion(version)
  const encodedOwner = encodeURIComponent(UPDATE_CONFIG.owner)
  const encodedRepo = encodeURIComponent(UPDATE_CONFIG.repo)
  const encodedName = String(fileName || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `https://github.com/${encodedOwner}/${encodedRepo}/releases/download/${tag}/${encodedName}`
}
function parseLatestYmlUpdateInfo(text: string, reason?: string): UpdateInfo {
  const latestVersion = normalizeVersion(yamlScalar(text, 'version') || APP_VERSION) || APP_VERSION
  const assetPath = yamlScalar(text, 'path') || yamlScalar(text, 'url') || `SimpleMusic-${latestVersion}-Setup.exe`
  const sha512 = normalizeDigest(yamlScalar(text, 'sha512'), 'sha512')
  const size = Number(yamlScalar(text, 'size') || 0) || 0
  const releaseDate = yamlScalar(text, 'releaseDate')
  const downloadUrl = githubReleaseDownloadUrl(latestVersion, assetPath)
  const candidates = uniqueDownloadCandidates(downloadUrl)
  const asset: UpdateAsset = {
    name: updateAssetNameFromUrl(downloadUrl) || assetPath,
    size,
    contentType: 'application/octet-stream',
    downloadUrl,
    downloadUrls: publicDownloadUrls(candidates),
    sha256: '',
    sha512,
  }
  return {
    configured: true,
    preview: false,
    updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: 'v' + latestVersion,
      name: 'Simple Music v' + latestVersion,
      version: latestVersion,
      publishedAt: releaseDate,
      htmlUrl: `https://github.com/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/tag/v${latestVersion}`,
      downloadUrl,
      asset,
      patch: null,
      patchAvailable: false,
      summary: '发现新版本，已启用备用更新线路。',
      notes: ['更新检测已切换到备用线路', '下载时会自动选择国内加速线路', '下载失败会显示具体原因和当前速度'],
    },
    source: 'latest-yml',
    reason: reason || '',
  }
}
async function fetchLatestYmlUpdateInfo(reason?: string): Promise<UpdateInfo> {
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github')
    throw updateError('UPDATE_REPOSITORY_NOT_CONFIGURED')
  const latestYmlUrl = `https://github.com/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(
    UPDATE_CONFIG.repo
  )}/releases/latest/download/latest.yml`
  const candidates = uniqueDownloadCandidates(latestYmlUrl)
  const result = await fetchTextFromCandidates(candidates, 6500)
  return parseLatestYmlUpdateInfo(result.text, reason)
}

// ---------- 检查最新版本（GitHub API → latest.yml → 本地回退） ----------
export async function fetchLatestUpdateInfo(): Promise<UpdateInfo> {
  if (UPDATE_CONFIG.manifest) return fetchManifestUpdateInfo(UPDATE_CONFIG.manifest)
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') return localUpdateFallback()
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(
    UPDATE_CONFIG.repo
  )}/releases/latest`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8500)
  try {
    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': `SimpleMusic/${APP_VERSION}`, Accept: 'application/vnd.github+json' },
    })
    if (!resp.ok) {
      try {
        return await fetchLatestYmlUpdateInfo('GitHub Releases ' + resp.status)
      } catch {
        return localUpdateFallback('GitHub Releases ' + resp.status, { configured: true })
      }
    }
    const data = asRecord(await resp.json())
    const latestVersion = normalizeVersion(data.tag_name || data.name || APP_VERSION) || APP_VERSION
    const asset = pickReleaseAsset(data.assets)
    const patch = pickPatchAsset(data.assets, APP_VERSION, latestVersion)
    const notes = extractReleaseNotes(data.body).length ? extractReleaseNotes(data.body) : UPDATE_FALLBACK_NOTES
    return {
      configured: true,
      preview: false,
      updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
      currentVersion: APP_VERSION,
      latestVersion,
      release: {
        tagName: String(data.tag_name || 'v' + latestVersion),
        name: String(data.name || 'Simple Music v' + latestVersion),
        version: latestVersion,
        publishedAt: String(data.published_at || ''),
        htmlUrl: String(data.html_url || ''),
        downloadUrl: asset ? asset.downloadUrl : '',
        asset,
        patch,
        patchAvailable: !!(patch && patch.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
        summary: notes[0] || '发现新版本，建议更新。',
        notes,
      },
    }
  } catch (err) {
    const reason = errMessage(err) || 'Update check failed'
    try {
      return await fetchLatestYmlUpdateInfo(reason)
    } catch (fallbackErr) {
      return localUpdateFallback(errMessage(fallbackErr) || reason, { configured: true })
    }
  } finally {
    clearTimeout(timer)
  }
}

// ---------- digest hash 工具 ----------
function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
function sha512Base64(buffer: Buffer): string {
  return crypto.createHash('sha512').update(buffer).digest('base64')
}
function sha512Hex(buffer: Buffer): string {
  return crypto.createHash('sha512').update(buffer).digest('hex')
}
function verifyUpdateBuffer(buffer: Buffer, job: UpdateJob): void {
  const expectedSize = Number(job.expectedSize || job.total || 0) || 0
  if (expectedSize > 0 && buffer.length !== expectedSize) {
    throw updateError('UPDATE_SIZE_MISMATCH', `Expected ${expectedSize} bytes, got ${buffer.length}`)
  }
  const expectedSha256 = normalizeDigest(job.sha256 || '', 'sha256').toLowerCase()
  if (expectedSha256 && sha256Hex(buffer) !== expectedSha256) {
    throw updateError('UPDATE_SHA256_MISMATCH', 'Downloaded sha256 mismatch')
  }
  const expectedSha512 = normalizeDigest(job.sha512 || '', 'sha512')
  if (expectedSha512) {
    const actualBase64 = sha512Base64(buffer)
    const actualHex = sha512Hex(buffer).toLowerCase()
    if (actualBase64 !== expectedSha512 && actualHex !== expectedSha512.toLowerCase()) {
      throw updateError('UPDATE_SHA512_MISMATCH', 'Downloaded sha512 mismatch')
    }
  }
}
function verifyUpdateFile(filePath: string, job: UpdateJob): void {
  verifyUpdateBuffer(fs.readFileSync(filePath), job)
}
function moveInvalidUpdateFile(filePath: string, reason?: string): void {
  try {
    if (!filePath || !fs.existsSync(filePath)) return
    const dir = path.dirname(filePath)
    const ext = path.extname(filePath)
    const base = path.basename(filePath, ext)
    const invalidPath = path.join(dir, `${base}.invalid-${Date.now()}${ext || '.bin'}`)
    fs.renameSync(filePath, invalidPath)
    console.warn('[UpdateDownload] cached installer moved aside:', reason || 'invalid', invalidPath)
  } catch (e) {
    console.warn('[UpdateDownload] failed to move invalid cached installer:', errMessage(e))
  }
}

// ---------- 任务公共视图 / 任务表维护 ----------
export function publicUpdateJob(job: UpdateJob | null | undefined): JobResult {
  if (!job) return { ok: false, error: 'UPDATE_JOB_NOT_FOUND' }
  return {
    ok: job.status !== 'error',
    id: job.id,
    status: job.status,
    progress: job.progress || 0,
    received: job.received || 0,
    total: job.total || 0,
    speedBps: job.speedBps || 0,
    etaSeconds: job.etaSeconds || 0,
    sourceLabel: job.sourceLabel || '',
    attempt: job.attempt || 0,
    attempts: job.attempts || 0,
    mode: job.mode || 'installer',
    message: job.message || '',
    restartRequired: !!job.restartRequired,
    cached: !!job.cached,
    fileName: job.fileName || '',
    filePath: job.status === 'ready' ? job.filePath : '',
    version: job.version || '',
    releaseUrl: job.releaseUrl || '',
    error: job.error || '',
    errorReason: job.errorReason || '',
    errorDetail: job.errorDetail || '',
    failedAttempts: Array.isArray(job.failedAttempts) ? job.failedAttempts.slice(0, 6) : [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}
function activeUpdateJobFor(version: string): UpdateJob | undefined {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return jobs.find(
    (job) =>
      job.version === version &&
      (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready')
  )
}
function trimUpdateJobs(): void {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  jobs.slice(8).forEach((job) => updateDownloadJobs.delete(job.id))
}

function safeUpdateFileName(name: unknown, version: string): string {
  const raw = String(name || '').trim() || `SimpleMusic-${version || APP_VERSION}.exe`
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  return cleaned || `SimpleMusic-${version || APP_VERSION}.exe`
}

function reuseVerifiedInstallerJob(opts: {
  filePath: string
  fileName: string
  version: string
  downloadUrl: string
  downloadCandidates: DownloadCandidate[]
  downloadDir: string
  expectedSize: number
  sha256: string
  sha512: string
  releaseUrl: string
  attempts: number
}): UpdateJob | null {
  if (!opts || !opts.filePath || !fs.existsSync(opts.filePath)) return null
  if (!opts.expectedSize && !opts.sha256 && !opts.sha512) return null
  const now = Date.now()
  const stat = fs.statSync(opts.filePath)
  const job: UpdateJob = {
    id: 'cached-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'ready',
    progress: 100,
    received: stat.size || 0,
    total: opts.expectedSize || stat.size || 0,
    speedBps: 0,
    etaSeconds: 0,
    sourceLabel: '本地缓存',
    attempt: 0,
    attempts: opts.attempts || 0,
    mode: 'installer',
    message: '安装包已下载，可直接打开安装',
    restartRequired: false,
    cached: true,
    fileName: opts.fileName || path.basename(opts.filePath),
    filePath: opts.filePath,
    version: opts.version || '',
    downloadUrl: opts.downloadUrl || '',
    downloadCandidates: opts.downloadCandidates || [],
    downloadDir: opts.downloadDir,
    expectedSize: opts.expectedSize || 0,
    sha256: opts.sha256 || '',
    sha512: opts.sha512 || '',
    releaseUrl: opts.releaseUrl || '',
    error: '',
    errorReason: '',
    errorDetail: '',
    failedAttempts: [],
    createdAt: now,
    updatedAt: now,
  }
  try {
    verifyUpdateFile(opts.filePath, job)
    updateDownloadJobs.set(job.id, job)
    trimUpdateJobs()
    return job
  } catch (err) {
    moveInvalidUpdateFile(opts.filePath, errMessage(err) || 'cache verification failed')
    return null
  }
}

function setUpdateJobError(job: UpdateJob, err: unknown, fallbackMessage?: string): void {
  const info = classifyUpdateError(err)
  job.status = 'error'
  job.error = info.code
  job.errorReason = info.reason
  job.errorDetail = info.detail
  job.message = fallbackMessage || info.reason
  job.updatedAt = Date.now()
}
function prepareUpdateJobAttempt(job: UpdateJob, candidate: DownloadCandidate, index: number, total: number): void {
  job.status = 'downloading'
  job.sourceLabel = candidate.label || '下载线路'
  job.attempt = index + 1
  job.attempts = total
  job.received = 0
  job.speedBps = 0
  job.etaSeconds = 0
  job.error = ''
  job.errorReason = ''
  job.errorDetail = ''
  job.updatedAt = Date.now()
}
function ensureMirrorCanBeVerified(job: UpdateJob, candidate: DownloadCandidate): void {
  if (!candidate || !candidate.mirrored) return
  if (job.sha256 || job.sha512) return
  throw updateError('MIRROR_HASH_MISSING', 'Mirror download skipped because no digest is available')
}

// ---------- 安装包下载（多线路 + 校验） ----------
async function downloadUpdateAssetWithMirrors(job: UpdateJob): Promise<void> {
  const tmpPath = job.filePath + '.download'
  const candidates =
    Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
      ? job.downloadCandidates
      : uniqueDownloadCandidates(job.downloadUrl || '')
  const failures: FailedAttempt[] = []
  fs.mkdirSync(job.downloadDir, { recursive: true })
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    try {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      ensureMirrorCanBeVerified(job, candidate)
      prepareUpdateJobAttempt(job, candidate, i, candidates.length)
      job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小'

      const resp = await fetchWithTimeout(candidate.url, { headers: { 'User-Agent': `SimpleMusic/${APP_VERSION}` } }, 14000)
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status)
      if (!resp.body) throw updateError('UPDATE_EMPTY_BODY', 'Download response has no body')

      const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0
      job.total = totalHeader || job.expectedSize || job.total || 0
      job.progress = 0
      job.updatedAt = Date.now()
      let speedWindowAt = Date.now()
      let speedWindowBytes = 0

      const writer = fs.createWriteStream(tmpPath)
      const reader = resp.body.getReader()
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          const buf = Buffer.from(chunk.value)
          job.received += buf.length
          speedWindowBytes += buf.length
          const now = Date.now()
          if (now - speedWindowAt >= 900) {
            job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000))
            speedWindowAt = now
            speedWindowBytes = 0
          }
          if (job.total > 0) {
            job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)))
            job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0
          } else {
            const kb = Math.max(1, job.received / 1024)
            job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)))
          }
          job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小'
          job.updatedAt = Date.now()
          if (!writer.write(buf)) await once(writer, 'drain')
        }
      } finally {
        writer.end()
        await once(writer, 'finish').catch(() => {})
      }

      verifyUpdateFile(tmpPath, job)
      if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath)
      fs.renameSync(tmpPath, job.filePath)
      job.status = 'ready'
      job.progress = 100
      job.etaSeconds = 0
      job.message = '安装包已下载'
      job.updatedAt = Date.now()
      return
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      const info = classifyUpdateError(err)
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail })
      job.failedAttempts = failures.slice(-6)
      job.message =
        i < candidates.length - 1 ? (candidate.label || '当前线路') + '失败，正在切换线路' : info.reason
      job.updatedAt = Date.now()
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '下载失败：' + info.reason)
    }
  }
}

export function startUpdateDownloadJob(info: UpdateInfo, ctx: ServerContext): JobResult {
  const release = info && info.release ? info.release : ({} as UpdateRelease)
  const asset = release.asset || ({} as UpdateAsset)
  const downloadUrl = release.downloadUrl || asset.downloadUrl || ''
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' }
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' }
  if (!/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'UPDATE_ASSET_MISSING' }

  const version = info.latestVersion || release.version || ''
  const existing = activeUpdateJobFor(version)
  if (existing) return publicUpdateJob(existing)

  const downloadDir = updateDownloadDir(ctx)
  const fileName = safeUpdateFileName(asset.name || '', version)
  const filePath = path.join(downloadDir, fileName)
  const downloadCandidates = uniqueDownloadCandidates(
    [downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : [])
  )
  const expectedSize = asset.size || 0
  const sha256 = normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase()
  const sha512 = normalizeDigest(asset.sha512 || '', 'sha512')
  const cached = reuseVerifiedInstallerJob({
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    downloadDir,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    attempts: downloadCandidates.length,
  })
  if (cached) return publicUpdateJob(cached)

  const now = Date.now()
  const job: UpdateJob = {
    id: now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: expectedSize,
    speedBps: 0,
    etaSeconds: 0,
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    mode: 'installer',
    message: '',
    restartRequired: false,
    cached: false,
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    downloadDir,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    error: '',
    errorReason: '',
    errorDetail: '',
    failedAttempts: [],
    createdAt: now,
    updatedAt: now,
  }
  updateDownloadJobs.set(job.id, job)
  trimUpdateJobs()
  void downloadUpdateAssetWithMirrors(job)
  return publicUpdateJob(job)
}

// ====================================================================
//  补丁热更新
//  原项目按文件名（server.js / dj-analyzer.js / package.json 等）将补丁
//  写回「源码即运行文件」的应用根目录。新项目源码已拆分并需打包，运行文件
//  与源码不再一一对应，按文件名打补丁无法安全映射到打包产物。
//  因此：保留端点 + 任务队列结构 + 下载链路，但在「应用到文件」这一步
//  直接返回 PATCH_NOT_SUPPORTED，不静默成功、不写任何文件。
// ====================================================================
function normalizePatchPayload(payload: unknown): { from: string; to: string; files: unknown[]; restartRequired: boolean } {
  const data = asRecord(payload)
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_PATCH_PAYLOAD')
  const type = String(data.type || data.kind || '')
  if (type && type !== 'simplemusic-resource-patch') throw new Error('UNSUPPORTED_PATCH_TYPE')
  const from = normalizeVersion(data.from || data.baseVersion || '')
  const to = normalizeVersion(data.to || data.version || data.targetVersion || '')
  const files = Array.isArray(data.files) ? (data.files as unknown[]) : []
  if (!from || compareVersions(from, APP_VERSION) !== 0) throw new Error('PATCH_VERSION_MISMATCH')
  if (!to || compareVersions(to, APP_VERSION) <= 0) throw new Error('PATCH_TARGET_VERSION_INVALID')
  if (!files.length) throw new Error('PATCH_EMPTY')
  if (files.length > 40) throw new Error('PATCH_TOO_MANY_FILES')
  return { from, to, files, restartRequired: data.restartRequired !== false }
}

// TODO: 补丁热更新在新架构暂不支持。
// 原 writePatchFile() 依赖 PATCH_ALLOWED_FILES（server.js/dj-analyzer.js/package.json...）
// 与 patchTargetPath()（解析到应用根目录的源码文件），即「源码即运行文件」的假设。
// 新项目为 electron-vite + TS + React，源码经打包后与运行产物不再对应，
// 无法安全地把补丁按文件名写回。此处显式抛错，待新架构的产物级补丁方案落地后再实现。
function applyPatchUnsupported(): never {
  throw updateError('PATCH_NOT_SUPPORTED', '补丁热更新在新架构暂不支持，请使用完整安装包更新')
}

async function downloadPatchBufferFromCandidate(
  job: UpdateJob,
  candidate: DownloadCandidate,
  index: number,
  total: number
): Promise<Buffer> {
  ensureMirrorCanBeVerified(job, candidate)
  prepareUpdateJobAttempt(job, candidate, index, total)
  job.mode = 'patch'
  job.message = '正在下载快速补丁'
  job.progress = 0
  job.updatedAt = Date.now()

  const resp = await fetchWithTimeout(candidate.url, { headers: { 'User-Agent': `SimpleMusic/${APP_VERSION}` } }, 12000)
  if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status)
  if (!resp.body) throw updateError('PATCH_EMPTY_BODY', 'Patch response has no body')

  job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.expectedSize || job.total || 0
  job.received = 0
  const chunks: Buffer[] = []
  const reader = resp.body.getReader()
  let speedWindowAt = Date.now()
  let speedWindowBytes = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    const buf = Buffer.from(chunk.value)
    job.received += buf.length
    speedWindowBytes += buf.length
    if (job.received > PATCH_MAX_BYTES) throw updateError('PATCH_TOO_LARGE', 'Patch package is too large')
    chunks.push(buf)
    const now = Date.now()
    if (now - speedWindowAt >= 700) {
      job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000))
      speedWindowAt = now
      speedWindowBytes = 0
    }
    job.progress =
      job.total > 0
        ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
        : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)))
    job.etaSeconds =
      job.total > 0 && job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0
    job.updatedAt = Date.now()
  }
  const raw = Buffer.concat(chunks)
  verifyUpdateBuffer(raw, job)
  return raw
}

async function downloadAndApplyPatchWithMirrors(job: UpdateJob): Promise<void> {
  const candidates =
    Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
      ? job.downloadCandidates
      : uniqueDownloadCandidates(job.downloadUrl || '')
  const failures: FailedAttempt[] = []
  fs.mkdirSync(job.downloadDir, { recursive: true })
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    try {
      const raw = await downloadPatchBufferFromCandidate(job, candidate, i, candidates.length)
      const patch = normalizePatchPayload(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')))
      job.version = patch.to
      job.message = '正在应用快速补丁'
      job.progress = 88
      job.etaSeconds = 0
      job.updatedAt = Date.now()
      // TODO: 补丁应用到文件这一步在新架构暂不支持，直接抛 PATCH_NOT_SUPPORTED。
      applyPatchUnsupported()
    } catch (err) {
      // PATCH_NOT_SUPPORTED 属架构限制而非网络问题，不再切换其它线路，直接定格错误。
      if (errCode(err) === 'PATCH_NOT_SUPPORTED') {
        job.status = 'error'
        job.error = 'PATCH_NOT_SUPPORTED'
        job.errorReason = '补丁热更新在新架构暂不支持，请改用完整安装包更新'
        job.errorDetail = errMessage(err)
        job.message = '补丁热更新暂不支持，请使用完整安装包'
        job.updatedAt = Date.now()
        return
      }
      const info = classifyUpdateError(err)
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail })
      job.failedAttempts = failures.slice(-6)
      job.message =
        i < candidates.length - 1 ? (candidate.label || '当前线路') + '失败，正在切换线路' : info.reason
      job.updatedAt = Date.now()
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '快速补丁失败：' + info.reason)
    }
  }
}

export function startUpdatePatchJob(info: UpdateInfo, ctx: ServerContext): JobResult {
  const release = info && info.release ? info.release : ({} as UpdateRelease)
  const patch = release.patch || ({} as PatchAsset)
  const downloadUrl = patch.downloadUrl || ''
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' }
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' }
  if (!release.patchAvailable || !/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'PATCH_ASSET_MISSING' }

  const version = info.latestVersion || release.version || patch.to || ''
  const existing = Array.from(updateDownloadJobs.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .find(
      (job) =>
        job.mode === 'patch' &&
        job.version === version &&
        (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready')
    )
  if (existing) return publicUpdateJob(existing)

  const now = Date.now()
  const downloadCandidates = uniqueDownloadCandidates(
    [downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : [])
  )
  const job: UpdateJob = {
    id: 'patch-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: patch.size || 0,
    speedBps: 0,
    etaSeconds: 0,
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    mode: 'patch',
    message: '等待下载快速补丁',
    restartRequired: true,
    cached: false,
    fileName: patch.name || safeUpdateFileName('', version).replace(/\.exe$/i, '.patch.json'),
    filePath: '',
    version,
    downloadUrl,
    downloadCandidates,
    downloadDir: updateDownloadDir(ctx),
    expectedSize: patch.size || 0,
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
    releaseUrl: release.htmlUrl || '',
    error: '',
    errorReason: '',
    errorDetail: '',
    failedAttempts: [],
    createdAt: now,
    updatedAt: now,
  }
  updateDownloadJobs.set(job.id, job)
  trimUpdateJobs()
  void downloadAndApplyPatchWithMirrors(job)
  return publicUpdateJob(job)
}
