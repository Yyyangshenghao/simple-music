import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

/**
 * Wallpaper Engine 壁纸库：读取本机 Steam 的 workshop 目录，把用户已订阅的壁纸列给渲染层。
 *
 * 与「自定义视频背景」不同，这里的文件不复制进 userData：
 * - 壁纸动辄几十 MB，订阅里常有上百个，复制会白白占一份空间；
 * - 网页型壁纸依赖同目录下的资源文件，整目录复制才能保持相对路径。
 * 代价是壁纸库移动/取消订阅后需要重新选择，UI 在找不到文件时回退到流体背景。
 */

const WORKSHOP_APP_ID = '431960'
const CONFIG_FILE = 'wallpaper-engine.json'
const CONFIG_VERSION = 1
const LIBRARY_TTL_MS = 15_000
const ROOTS_TTL_MS = 60_000
/** 单个壁纸库的条目上限，避免异常目录把扫描拖成分钟级。 */
const MAX_WALLPAPERS = 5000

export type WallpaperEngineType = 'video' | 'web' | 'scene' | 'application' | 'unknown'

/** 返回给渲染层的条目：只带展示所需字段，绝对路径不离开主进程。 */
export interface WallpaperEngineItem {
  id: string
  title: string
  type: WallpaperEngineType
  hasPreview: boolean
}

export interface WallpaperEngineLibrary {
  /** 找到的 Steam 库数量；0 表示本机没检测到。 */
  roots: number
  /** 用户手动指定的壁纸目录；null 表示自动检测。 */
  customRoot: string | null
  wallpapers: WallpaperEngineItem[]
}

/** 服务端内部使用的完整条目。 */
interface WallpaperEngineProject extends WallpaperEngineItem {
  dir: string
  /** 可直接播放/打开的入口文件绝对路径；场景型等无法在应用内渲染的类型为 null。 */
  entry: string | null
  /** 预览图绝对路径。 */
  preview: string | null
}

export class WallpaperEngineError extends Error {}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const PREVIEW_FALLBACKS = ['preview.jpg', 'preview.jpeg', 'preview.png', 'preview.gif', 'preview.webp', 'preview.avif']

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
}

export function wallpaperContentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] || 'application/octet-stream'
}

export function isWallpaperId(value: string): boolean {
  return /^\d{1,20}$/.test(value)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fsp.stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await fsp.stat(path)).isFile()
  } catch {
    return false
  }
}

/** target 必须严格位于 root 内部（不允许等于 root），挡住 project.json 里的 ../ 越界。 */
function resolveInside(root: string, target: string): string | null {
  const full = resolve(root, target)
  const rel = relative(resolve(root), full)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return full
}

// ---------------------------------------------------------------------------
// Steam 库探测

const execFileAsync = promisify(execFile)

/** 注册表里的 Steam 安装目录。PowerShell 显式设 UTF-8，避免中文安装路径经 OEM 代码页读成乱码。 */
async function readRegistryValue(key: string, name: string): Promise<string | null> {
  try {
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-ItemProperty -LiteralPath 'Registry::${key}' -Name '${name}' -ErrorAction Stop).'${name}'`
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 4000,
      windowsHide: true,
      encoding: 'utf8'
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** 解析 libraryfolders.vdf；新旧两种格式都认。 */
export function parseLibraryFoldersVdf(text: string): string[] {
  const unescape = (value: string) => value.replace(/\\(["\\])/g, '$1')
  const paths: string[] = []
  for (const match of text.matchAll(/^\s*"path"\s+"((?:[^"\\]|\\.)*)"/gm)) paths.push(unescape(match[1]))
  if (paths.length) return paths
  // 旧版 Steam 没有 "path" 键，库目录直接挂在数字键下。
  for (const match of text.matchAll(/^\s*"\d+"\s+"((?:[^"\\]|\\.)*)"/gm)) paths.push(unescape(match[1]))
  return paths
}

/** 一个用户选定的目录如何归一成 workshop 内容目录：支持 Steam 根目录、steamapps、content、431960 本身。 */
export async function resolveWorkshopContentDir(path: string): Promise<string | null> {
  const candidates = [
    // 只有目录本身就叫 431960 才可能是内容目录，否则它只是 Steam/steamapps 这类父目录。
    ...(basename(path) === WORKSHOP_APP_ID ? [path] : []),
    join(path, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID),
    join(path, 'workshop', 'content', WORKSHOP_APP_ID),
    join(path, 'content', WORKSHOP_APP_ID),
    join(path, WORKSHOP_APP_ID)
  ]
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) return resolve(candidate)
  }
  return null
}

async function steamInstallDirs(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const dirs = new Set<string>()
  for (const [key, name] of [
    ['HKEY_CURRENT_USER\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKEY_LOCAL_MACHINE\\SOFTWARE\\Valve\\Steam', 'InstallPath']
  ] as const) {
    const value = await readRegistryValue(key, name)
    if (value) dirs.add(value)
  }
  for (const env of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
    if (env) dirs.add(join(env, 'Steam'))
  }
  dirs.add('C:\\Program Files (x86)\\Steam')
  return [...dirs]
}

let rootsCache: { at: number; roots: string[] } | null = null
let rootsInflight: Promise<string[]> | null = null

/** 自动检测所有 Steam 库（安装目录 + libraryfolders.vdf 里登记的其他库）。 */
export async function detectSteamRoots(): Promise<string[]> {
  if (rootsCache && Date.now() - rootsCache.at < ROOTS_TTL_MS) return rootsCache.roots
  // 首次加载壁纸网格会并发发出几十个预览请求，探测只跑一次。
  if (rootsInflight) return rootsInflight
  rootsInflight = detectSteamRootsUncached().finally(() => { rootsInflight = null })
  return rootsInflight
}

async function detectSteamRootsUncached(): Promise<string[]> {
  const installs = await steamInstallDirs()
  const roots: string[] = []
  const seen = new Set<string>()
  const add = (path: string) => {
    const key = resolve(path).toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      roots.push(path)
    }
  }
  for (const install of installs) {
    if (!(await isDirectory(install))) continue
    add(install)
    for (const vdf of [join(install, 'steamapps', 'libraryfolders.vdf'), join(install, 'config', 'libraryfolders.vdf')]) {
      const text = await fsp.readFile(vdf, 'utf8').catch(() => null)
      if (!text) continue
      for (const path of parseLibraryFoldersVdf(text)) if (isAbsolute(path) && await isDirectory(path)) add(path)
    }
  }
  rootsCache = { at: Date.now(), roots }
  return roots
}

// ---------------------------------------------------------------------------
// 配置与扫描

interface StoredConfig {
  version?: number
  root?: unknown
}

async function readCustomRoot(userDataDir: string): Promise<string | null> {
  try {
    const config = JSON.parse(await fsp.readFile(join(userDataDir, CONFIG_FILE), 'utf8')) as StoredConfig
    return typeof config?.root === 'string' && isAbsolute(config.root) ? config.root : null
  } catch {
    return null
  }
}

function normalizeType(value: unknown): WallpaperEngineType {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return type === 'video' || type === 'web' || type === 'scene' || type === 'application' ? type : 'unknown'
}

async function resolvePreview(dir: string, value: unknown): Promise<string | null> {
  const declared = typeof value === 'string' && value.trim() ? resolveInside(dir, value.trim()) : null
  if (declared && await isFile(declared)) return declared
  for (const name of PREVIEW_FALLBACKS) {
    const candidate = join(dir, name)
    if (await isFile(candidate)) return candidate
  }
  return null
}

async function resolveEntry(dir: string, type: WallpaperEngineType, value: unknown): Promise<string | null> {
  const declared = typeof value === 'string' && value.trim() ? resolveInside(dir, value.trim()) : null
  if (type === 'video') {
    if (!declared || !VIDEO_EXTENSIONS.has(extname(declared).toLowerCase())) return null
    return await isFile(declared) ? declared : null
  }
  if (type === 'web') {
    const fallback = join(dir, 'index.html')
    if (declared && HTML_EXTENSIONS.has(extname(declared).toLowerCase()) && await isFile(declared)) return declared
    return await isFile(fallback) ? fallback : null
  }
  return null
}

/** 读取单个 workshop 工程；project.json 缺失/损坏的条目直接跳过，列表里不出现坏卡片。 */
async function readProject(dir: string, id: string): Promise<WallpaperEngineProject | null> {
  let raw: string
  try {
    raw = await fsp.readFile(join(dir, 'project.json'), 'utf8')
  } catch {
    return null
  }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, '')) as Record<string, unknown>
  } catch {
    return null
  }
  const type = normalizeType(data.type)
  const entry = await resolveEntry(dir, type, data.file)
  // 视频/网页型必须有可加载的入口，否则选中后只能得到一块空白。
  if ((type === 'video' || type === 'web') && !entry) return null
  const preview = await resolvePreview(dir, data.preview)
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : id
  return { id, title, type, hasPreview: preview !== null, dir, entry, preview }
}

async function scanContentDir(contentDir: string): Promise<WallpaperEngineProject[]> {
  let entries
  try {
    entries = await fsp.readdir(contentDir, { withFileTypes: true })
  } catch {
    return []
  }
  const projects: WallpaperEngineProject[] = []
  for (const entry of entries.slice(0, MAX_WALLPAPERS)) {
    if (!entry.isDirectory() || !isWallpaperId(entry.name)) continue
    const project = await readProject(join(contentDir, entry.name), entry.name)
    if (project) projects.push(project)
  }
  return projects
}

interface LibraryCache {
  key: string
  at: number
  library: WallpaperEngineLibrary
  projects: Map<string, WallpaperEngineProject>
}

let cache: LibraryCache | null = null

export function clearWallpaperEngineCache(): void {
  cache = null
  rootsCache = null
}

export interface LibraryOptions {
  /** 测试/调试：直接指定 Steam 库目录，跳过自动探测。 */
  roots?: string[]
  /** 忽略缓存重新扫描。 */
  refresh?: boolean
}

/** 扫描串行队列：壁纸网格会同时请求几十张预览图，排在后面的请求直接复用刚扫完的结果。 */
let buildQueue: Promise<unknown> = Promise.resolve()

function cacheFresh(key: string, refresh: boolean | undefined): boolean {
  return !refresh && !!cache && cache.key === key && Date.now() - cache.at < LIBRARY_TTL_MS
}

async function buildLibrary(userDataDir: string, options: LibraryOptions): Promise<LibraryCache> {
  const customRoot = options.roots ? null : await readCustomRoot(userDataDir)
  const roots = options.roots ?? (customRoot ? [customRoot] : await detectSteamRoots())
  const contentDirs: string[] = []
  for (const root of roots) {
    const contentDir = await resolveWorkshopContentDir(root)
    if (contentDir && !contentDirs.includes(contentDir)) contentDirs.push(contentDir)
  }
  const key = contentDirs.join('|')
  if (cacheFresh(key, options.refresh)) return cache!

  const run = buildQueue.then(async (): Promise<LibraryCache> => {
    if (cacheFresh(key, options.refresh)) return cache!
    const projects = new Map<string, WallpaperEngineProject>()
    for (const contentDir of contentDirs) {
      for (const project of await scanContentDir(contentDir)) {
        if (!projects.has(project.id)) projects.set(project.id, project)
      }
    }
    const wallpapers = [...projects.values()]
      .map(({ id, title, type, hasPreview }) => ({ id, title, type, hasPreview }))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
    const library: WallpaperEngineLibrary = { roots: contentDirs.length, customRoot, wallpapers }
    cache = { key, at: Date.now(), library, projects }
    return cache
  })
  buildQueue = run.catch(() => {})
  return run
}

/** 列出已订阅壁纸。 */
export async function getWallpaperEngineLibrary(userDataDir: string, options: LibraryOptions = {}): Promise<WallpaperEngineLibrary> {
  return (await buildLibrary(userDataDir, options)).library
}

/** 设置手动目录；null 表示恢复自动检测。校验失败抛 WallpaperEngineError。 */
export async function setWallpaperEngineRoot(
  userDataDir: string,
  path: string | null,
  options: Omit<LibraryOptions, 'refresh'> = {}
): Promise<WallpaperEngineLibrary> {
  clearWallpaperEngineCache()
  if (path === null) {
    await fsp.rm(join(userDataDir, CONFIG_FILE), { force: true })
    return getWallpaperEngineLibrary(userDataDir, { ...options, refresh: true })
  }
  if (!isAbsolute(path)) throw new WallpaperEngineError('WALLPAPER_DIR_INVALID')
  if (!(await resolveWorkshopContentDir(path))) throw new WallpaperEngineError('WALLPAPER_DIR_INVALID')
  await fsp.mkdir(userDataDir, { recursive: true })
  await fsp.writeFile(join(userDataDir, CONFIG_FILE), JSON.stringify({ version: CONFIG_VERSION, root: path }, null, 2))
  return getWallpaperEngineLibrary(userDataDir, { ...options, refresh: true })
}

/** 按 workshop id 找到工程；缓存里没有时重新扫描一次（用户可能刚订阅）。 */
export async function getWallpaperEngineProject(
  userDataDir: string,
  id: string,
  options: Omit<LibraryOptions, 'refresh'> = {}
): Promise<WallpaperEngineProject | null> {
  if (!isWallpaperId(id)) return null
  // 播放中的视频会持续发 Range 请求；有缓存就直接用，不按列表 TTL 反复重扫。
  let state = cache ?? await buildLibrary(userDataDir, options)
  let project = state.projects.get(id)
  if (!project) {
    state = await buildLibrary(userDataDir, { ...options, refresh: true })
    project = state.projects.get(id)
  }
  return project ?? null
}

/** 网页型壁纸按相对路径取文件；越界路径返回 null。 */
export function resolveWallpaperWebFile(project: WallpaperEngineProject, relativePath: string): string | null {
  if (project.type !== 'web' || !project.entry) return null
  if (!relativePath || relativePath === '/') return project.entry
  return resolveInside(project.dir, relativePath.replace(/^[/\\]+/, ''))
}

/**
 * 场景型壁纸的工程目录本身就是渲染引擎的资源根（project.json、scene.pkg、
 * shaders/ 等），按相对路径取文件即可；越界路径返回 null。
 */
export function resolveWallpaperSceneFile(project: WallpaperEngineProject, relativePath: string): string | null {
  if (project.type !== 'scene' || !relativePath || relativePath === '/') return null
  return resolveInside(project.dir, relativePath.replace(/^[/\\]+/, ''))
}

/** 视频型壁纸的入口文件。 */
export function resolveWallpaperVideoFile(project: WallpaperEngineProject): string | null {
  return project.type === 'video' && project.entry ? project.entry : null
}

/** 预览图文件（场景型只能显示它）。 */
export function resolveWallpaperPreviewFile(project: WallpaperEngineProject): string | null {
  return project.preview
}
