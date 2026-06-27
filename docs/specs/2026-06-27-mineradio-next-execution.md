# Mineradio-Next 执行文档（实现计划）

> **给执行者：** 本文档配套设计文档 [`2026-06-27-mineradio-next-design.md`](./2026-06-27-mineradio-next-design.md)。建议用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 按任务逐条执行；每个步骤用 `- [ ]` 复选框跟踪。
>
> **性质：** 这是一次**移植式重写**——功能对齐参考项目 `/Users/yangshenghao/github/Mineradio`，而非从零设计。绝大多数任务的本质是「读原项目某文件 → 拆分/类型化 → 落到新结构」。每个任务都标注了**源文件**，执行时必须先读源文件再动手。

**目标：** 在 `Mineradio-Next/` 用 TypeScript + React 18 + electron-vite 重写 Mineradio，功能对齐 v1.1.0，并新增 macOS 支持。

**架构：** 三进程解耦——Electron 主进程（窗口/IPC/平台）、React 渲染层（UI/状态/可视化）、独立 HTTP Server（音乐 API 代理）。主进程与 Server 可分别调试。

**技术栈：** Electron + electron-vite + Vite + React 18 + TypeScript + Zustand + @react-three/fiber + CSS Modules + electron-builder。

---

## 全局约束（每个任务都隐含遵守）

- **语言：** 全栈 TypeScript，`strict: true`。禁止 `any` 兜底（确需时用 `unknown` + 收窄）。
- **Node/Electron：** Electron `^42`，Node 内置模块走 ESM import。
- **跨平台：** 任何使用 PowerShell / Win32 / `.lnk` / WorkerW 的代码必须经 `electron/platform` 适配层，禁止在通用模块里直接写平台分支。
- **路径：** 禁止硬编码绝对路径（尤其原项目 `D:\\MineradioCache\\beatmaps` 这类）。缓存/存档统一走 `app.getPath('userData')`。
- **IPC：** 所有 IPC 通道必须在 `src/types/ipc.ts` 的 `IpcChannels` / `IpcEvents` 中先声明类型，再实现。禁止裸字符串通道。
- **存档兼容：** 用户存档 `.json` 格式与现有 Mineradio **完全兼容**，可互相导入导出。参考 `Mineradio/public/default-user-fx-archive.json`。
- **样式：** 组件样式一律 CSS Modules（`*.module.css`），禁止全局污染（全局仅保留 reset / 字体 / CSS 变量）。
- **提交：** 每个任务末尾提交一次，message 用 Conventional Commits（`feat:` / `refactor:` / `chore:`）。提交信息结尾加：
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **参考项目只读：** 不修改 `/Users/yangshenghao/github/Mineradio`，仅作为移植来源阅读。

### 源文件映射速查（移植来源 → 目标）

| 源文件（Mineradio/） | 行数 | 目标（Mineradio-Next/） |
|---|---|---|
| `server.js` | 4203 | `server/index.ts` + `server/routes/*` + `server/lib/*` |
| `dj-analyzer.js` | 864 | `src/lib/dj-analyzer.ts` |
| `desktop/main.js` | 1470 | `electron/main.ts` + `electron/modules/*` + `electron/ipc/*` + `electron/platform/*` |
| `desktop/preload.js` | 52 | `electron/preload/index.ts` |
| `desktop/overlay-preload.js` | 19 | `electron/preload/overlay.ts` |
| `public/index.html` | 26879 | `src/**`（拆成 React 组件 + stores + hooks） |
| `public/desktop-lyrics.html` | — | `overlays/desktop-lyrics/` |
| `public/wallpaper.html` | — | `overlays/wallpaper/` |
| `public/default-user-fx-archive.json` | — | `public/default-user-fx-archive.json`（原样复制） |

---

## 阶段总览

| 阶段 | 名称 | 产出 | 可独立验证 |
|---|---|---|---|
| 0 | 项目脚手架 | 可 `dev` 起空窗口 | electron-vite 启动成功 |
| 1 | Server 层 | 独立可跑的 API 服务 | `ts-node` 启动 + curl 命中端点 |
| 2 | Electron 主进程 | 窗口/IPC/平台/preload | 主窗口可控、IPC 通 |
| 3 | 渲染层基础 | stores + lib + hooks + 类型 | 单测通过、bridge 联通 |
| 4 | UI 组件 | 完整可交互界面 | 搜索→播放→歌词全链路 |
| 5 | Overlays | 桌面歌词 + 壁纸 | Windows 上注入成功 |
| 6 | 平台适配与打包 | DMG / NSIS 安装包 | `build:mac` / `build:win` 出包 |

> **执行建议：** 阶段 1（Server）与阶段 2/3（Electron+渲染）可并行——Server 解耦，先把它跑通能让后续前端有真实数据。阶段 4 依赖 3，阶段 5 依赖 2+4，阶段 6 最后。

---

# 阶段 0：项目脚手架

**目标：** 建立 electron-vite 工程，能 `npm run dev` 起一个空的 React 窗口。

## 文件结构（本阶段创建）

```
Mineradio-Next/
├── package.json
├── tsconfig.json            # 渲染层 + 共享
├── tsconfig.node.json       # 主进程 / server / vite 配置
├── electron-vite.config.ts
├── .gitignore
├── electron/main.ts         # 最小空窗口
├── electron/preload/index.ts
├── src/main.tsx
├── src/App.tsx
└── index.html               # 渲染层入口 HTML
```

---

### Task 0.1：初始化 package.json 与依赖

**Files:**
- Create: `package.json`

**Interfaces:**
- Produces: `scripts.dev/build/build:win/build:mac`（见设计文档第 9 节）；依赖清单供后续所有任务使用。

- [ ] **Step 1：写 package.json**

```json
{
  "name": "mineradio-next",
  "productName": "Mineradio",
  "version": "2.0.0",
  "description": "沉浸式音乐播放器（TypeScript + React 重写版）",
  "author": "Mineradio",
  "main": "out/main/index.js",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.json",
    "build:win": "npm run build && electron-builder --win",
    "build:mac": "npm run build && electron-builder --mac",
    "server:dev": "tsx server/index.ts"
  },
  "dependencies": {
    "NeteaseCloudMusicApi": "^4.32.0",
    "mpg123-decoder": "^1.0.3",
    "gsap": "^3.15.0",
    "zustand": "^4.5.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "three": "^0.169.0",
    "@react-three/fiber": "^8.17.0",
    "@react-three/drei": "^9.114.0"
  },
  "devDependencies": {
    "electron": "^42.4.1",
    "electron-vite": "^2.3.0",
    "electron-builder": "^26.15.3",
    "vite": "^5.4.0",
    "typescript": "^5.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/three": "^0.169.0",
    "@types/node": "^20.14.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tsx": "^4.16.0",
    "vitest": "^2.0.0"
  }
}
```

> 版本号以安装时实际可解析为准；若 registry 无对应版本，取最近的次版本，不要降大版本。

- [ ] **Step 2：安装依赖**

Run: `cd /Users/yangshenghao/github/Mineradio-Next && npm install`
Expected: 成功生成 `node_modules` 与 `package-lock.json`，无 peer 致命错误。

- [ ] **Step 3：提交**

```bash
git add package.json package-lock.json
git commit -m "chore: init package.json and dependencies"
```

---

### Task 0.2：TypeScript 与 electron-vite 配置

**Files:**
- Create: `tsconfig.json`, `tsconfig.node.json`, `electron-vite.config.ts`, `.gitignore`

**Interfaces:**
- Produces: 三个构建目标（main / preload / renderer）+ 路径别名 `@renderer` → `src`。

- [ ] **Step 1：写 `.gitignore`**

```
node_modules/
out/
dist/
*.log
.DS_Store
```

- [ ] **Step 2：写 `tsconfig.node.json`（主进程 / server / 配置）**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["electron/**/*", "server/**/*", "electron-vite.config.ts"]
}
```

- [ ] **Step 3：写 `tsconfig.json`（渲染层）**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@renderer/*": ["src/*"] }
  },
  "include": ["src/**/*", "overlays/**/*"]
}
```

- [ ] **Step 4：写 `electron-vite.config.ts`**

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve('electron/main.ts') } } } },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/preload/index.ts'),
          overlay: resolve('electron/preload/overlay.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    resolve: { alias: { '@renderer': resolve('src') } },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('index.html'),
          'desktop-lyrics': resolve('overlays/desktop-lyrics/desktop-lyrics.html'),
          wallpaper: resolve('overlays/wallpaper/wallpaper.html')
        }
      }
    }
  }
})
```

> overlay preload 与 overlays 入口暂时引用尚不存在的文件——本阶段先建占位（见 Task 0.3），阶段 5 再补内容。

- [ ] **Step 5：提交**

```bash
git add tsconfig.json tsconfig.node.json electron-vite.config.ts .gitignore
git commit -m "chore: add typescript and electron-vite config"
```

---

### Task 0.3：最小可运行的主进程 + 渲染层骨架

**Files:**
- Create: `electron/main.ts`, `electron/preload/index.ts`, `electron/preload/overlay.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`
- Create（占位）: `overlays/desktop-lyrics/desktop-lyrics.html`, `overlays/desktop-lyrics/index.tsx`, `overlays/wallpaper/wallpaper.html`, `overlays/wallpaper/index.tsx`

**Interfaces:**
- Produces: `createWindow()` 主窗口；渲染层挂载到 `#root`。

- [ ] **Step 1：写 `electron/main.ts`（最小空窗口）**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.js') }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
```

- [ ] **Step 2：写 `electron/preload/index.ts`（占位）**

```ts
// 阶段 2 填充 contextBridge 暴露的 API
export {}
```

- [ ] **Step 3：写 `electron/preload/overlay.ts`（占位）**

```ts
export {}
```

- [ ] **Step 4：写 `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><title>Mineradio</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5：写 `src/main.tsx` 与 `src/App.tsx`**

```tsx
// src/main.tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

```tsx
// src/App.tsx
export default function App() {
  return <h1>Mineradio-Next</h1>
}
```

- [ ] **Step 6：写 overlays 占位（4 个文件）**

```html
<!-- overlays/desktop-lyrics/desktop-lyrics.html -->
<!doctype html><html><body><div id="root"></div>
<script type="module" src="./index.tsx"></script></body></html>
```
```tsx
// overlays/desktop-lyrics/index.tsx
export {} // 阶段 5 填充
```
`overlays/wallpaper/*` 同理（把 desktop-lyrics 换成 wallpaper）。

- [ ] **Step 7：启动验证**

Run: `cd /Users/yangshenghao/github/Mineradio-Next && npm run dev`
Expected: 弹出无边框窗口，显示 "Mineradio-Next"。Ctrl+C 退出。

- [ ] **Step 8：typecheck**

Run: `npm run typecheck`
Expected: 无错误。

- [ ] **Step 9：提交**

```bash
git add electron src index.html overlays
git commit -m "feat: minimal electron-vite app skeleton boots"
```

---

# 阶段 1：Server 层

**目标：** 将 `Mineradio/server.js`（4203 行原生 HTTP）拆分为 `server/` 模块化 TypeScript，可用 `npm run server:dev` 独立启动并被 curl 命中。

**源文件：** `Mineradio/server.js`（务必通读，端点清单见下表）、`Mineradio/dj-analyzer.js`（被 `/api/podcast/dj-beatmap` 调用，阶段 3 再正式移植，本阶段先用占位）。

## 端点清单（来自 server.js，必须全部覆盖）

| 路由文件 | 端点 |
|---|---|
| `routes/netease.ts` | `/api/search` `/api/song/url` `/api/lyric` `/api/song/comments` `/api/artist/detail` `/api/playlist/tracks` `/api/user/playlists` `/api/login/cookie` `/api/login/qr/key` `/api/login/qr/create` `/api/login/qr/check` `/api/login/status` `/api/logout` `/api/song/like` `/api/song/like/check` `/api/playlist/create` `/api/playlist/add-song` `/api/discover/home` `/api/cover` `/api/audio` |
| `routes/podcast.ts`（电台，可并入 netease） | `/api/podcast/search` `/api/podcast/hot` `/api/podcast/detail` `/api/podcast/programs` `/api/podcast/my` `/api/podcast/my/items` `/api/podcast/dj-beatmap` |
| `routes/qq-music.ts` | `/api/qq/search` `/api/qq/song/url` `/api/qq/lyric` `/api/qq/login/status` `/api/qq/login/cookie` `/api/qq/logout` `/api/qq/user/playlists` `/api/qq/playlist/tracks` `/api/qq/artist/detail` `/api/qq/song/comments` |
| `routes/weather.ts` | `/api/weather/radio` `/api/weather/ip-location` |
| `routes/update.ts` | `/api/app/version` `/api/update/latest` `/api/update/download` `/api/update/download/status` `/api/update/patch` `/api/update/patch/status` `/api/beatmap/cache` `/api/beatmap/cache/status` |
| `routes/static.ts` | `/favicon.ico` + `public/` 静态 + `/` → index |

## 文件结构（本阶段创建）

```
server/
├── index.ts            # createServer + 路由分发 + .listen
├── lib/
│   ├── http.ts         # 请求/响应工具：readBody、json、sendJson、错误包装
│   ├── cookie.ts       # netease/qq cookie 读写（userData 持久化）
│   ├── proxy.ts        # 上游请求转发（cover/audio 流式代理）
│   └── update.ts       # GitHub Release 检查、下载、digest 校验、补丁
├── routes/
│   ├── netease.ts
│   ├── podcast.ts
│   ├── qq-music.ts
│   ├── weather.ts
│   ├── update.ts
│   └── static.ts
└── types.ts            # ServerContext、RouteHandler、上游响应类型
```

---

### Task 1.1：Server 核心类型与 HTTP 工具

**Files:**
- Create: `server/types.ts`, `server/lib/http.ts`

**Interfaces:**
- Produces:
  - `interface ServerContext { userDataDir: string; port: number }`
  - `type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL, ctx: ServerContext) => Promise<boolean>`（返回 `true` 表示已处理，`false` 表示未命中继续匹配）
  - `readBody(req): Promise<string>`、`readJson<T>(req): Promise<T>`
  - `sendJson(res, data, status?)`、`sendError(res, status, message)`

- [ ] **Step 1：写 `server/types.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ServerContext {
  userDataDir: string
  port: number
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ServerContext
) => Promise<boolean>

export interface OkResult { ok: boolean; message?: string }
```

- [ ] **Step 2：写 `server/lib/http.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req)
  return body ? (JSON.parse(body) as T) : ({} as T)
}

export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const buf = Buffer.from(JSON.stringify(data))
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(buf)
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, { ok: false, error: message }, status)
}
```

- [ ] **Step 3：单测 `server/lib/http.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { sendJson } from './http'

function fakeRes() {
  const chunks: Buffer[] = []
  return {
    statusCode: 0, headers: {} as Record<string, string>,
    writeHead(s: number, h: Record<string, string>) { this.statusCode = s; this.headers = h },
    end(b: Buffer) { chunks.push(b) },
    get body() { return Buffer.concat(chunks).toString() }
  }
}

describe('sendJson', () => {
  it('writes json with 200', () => {
    const res = fakeRes()
    sendJson(res as never, { a: 1 })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ a: 1 })
  })
})
```

- [ ] **Step 4：运行单测**

Run: `npx vitest run server/lib/http.test.ts`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add server/types.ts server/lib/http.ts server/lib/http.test.ts
git commit -m "feat(server): add core types and http utils"
```

---

### Task 1.2：Cookie 与缓存路径（修复硬编码 bug）

**Files:**
- Create: `server/lib/cookie.ts`
- Source: 阅读 `Mineradio/server.js` 中 cookie 持久化逻辑与 `BEATMAP_CACHE_DIR`、`PATCH_ALLOWED_FILES`（第 71 行）相关片段。

**Interfaces:**
- Consumes: `ServerContext.userDataDir`（Task 1.1）。
- Produces:
  - `getCookie(ctx, source: 'netease'|'qq'): string`
  - `setCookie(ctx, source, cookie: string): void`
  - `clearCookie(ctx, source): void`
  - `getBeatmapCacheDir(ctx): string`（**替代** 原 `D:\\MineradioCache\\beatmaps`，改为 `join(userDataDir, 'beatmaps')`）

- [ ] **Step 1：写 `server/lib/cookie.ts`**

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerContext } from '../types'

type Source = 'netease' | 'qq'
const file = (ctx: ServerContext, s: Source) => join(ctx.userDataDir, `cookie-${s}.txt`)

export function getCookie(ctx: ServerContext, s: Source): string {
  const f = file(ctx, s)
  return existsSync(f) ? readFileSync(f, 'utf-8') : ''
}
export function setCookie(ctx: ServerContext, s: Source, cookie: string): void {
  mkdirSync(ctx.userDataDir, { recursive: true })
  writeFileSync(file(ctx, s), cookie, 'utf-8')
}
export function clearCookie(ctx: ServerContext, s: Source): void {
  const f = file(ctx, s)
  if (existsSync(f)) rmSync(f)
}
export function getBeatmapCacheDir(ctx: ServerContext): string {
  const dir = join(ctx.userDataDir, 'beatmaps')
  mkdirSync(dir, { recursive: true })
  return dir
}
```

- [ ] **Step 2：单测验证路径不再硬编码**

`server/lib/cookie.test.ts`：用临时目录作 `userDataDir`，断言 `getBeatmapCacheDir` 返回值以该临时目录开头、且 `setCookie`/`getCookie` 往返一致。

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCookie, getCookie, getBeatmapCacheDir } from './cookie'

const ctx = { userDataDir: mkdtempSync(join(tmpdir(), 'mr-')), port: 0 }
describe('cookie & cache', () => {
  it('roundtrips cookie', () => { setCookie(ctx, 'netease', 'abc'); expect(getCookie(ctx, 'netease')).toBe('abc') })
  it('cache dir under userData', () => { expect(getBeatmapCacheDir(ctx).startsWith(ctx.userDataDir)).toBe(true) })
})
```

- [ ] **Step 3：运行单测**

Run: `npx vitest run server/lib/cookie.test.ts`
Expected: PASS。

- [ ] **Step 4：提交**

```bash
git add server/lib/cookie.ts server/lib/cookie.test.ts
git commit -m "feat(server): cookie store and userData-based cache path (fix hardcoded D: path)"
```

---

### Task 1.3：网易云路由（核心）

**Files:**
- Create: `server/routes/netease.ts`
- Source: `Mineradio/server.js` 中 `/api/search`、`/api/song/url`、`/api/lyric`、`/api/login/*`、`/api/user/playlists`、`/api/playlist/tracks`、`/api/song/like*`、`/api/discover/home`、`/api/artist/detail`、`/api/song/comments` 等处理块（行号见上方端点清单）。

**Interfaces:**
- Consumes: `RouteHandler`（1.1）、cookie API（1.2）、`NeteaseCloudMusicApi` 包。
- Produces: `export const neteaseRoutes: RouteHandler`——内部按 `url.pathname` 分发，命中返回 `true`。

- [ ] **Step 1：搭 `neteaseRoutes` 骨架**

逐个端点移植 `server.js` 对应逻辑。关键转换规则：
1. `require('NeteaseCloudMusicApi')` → `import * as NCM from 'NeteaseCloudMusicApi'`。
2. 上游调用统一带 `cookie: getCookie(ctx, 'netease')`。
3. 原始 `res.end(JSON.stringify(...))` → `sendJson(res, ...)`。
4. `/api/login/cookie`、`/api/login/qr/check` 登录成功后 `setCookie(ctx,'netease',...)`；`/api/logout` 调 `clearCookie`。
5. 错误统一 `sendError(res, 500, e.message)`。

```ts
import * as NCM from 'NeteaseCloudMusicApi'
import type { RouteHandler } from '../types'
import { sendJson, sendError, readJson } from '../lib/http'
import { getCookie, setCookie, clearCookie } from '../lib/cookie'

export const neteaseRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname
  const cookie = getCookie(ctx, 'netease')
  try {
    if (pn === '/api/search') {
      const r = await NCM.search({ keywords: url.searchParams.get('keywords') ?? '', cookie })
      sendJson(res, r.body); return true
    }
    // … 其余端点按 server.js 逐个移植 …
    return false
  } catch (e) {
    sendError(res, 500, (e as Error).message); return true
  }
}
```

> 移植时**逐端点对照** server.js 的入参解析、上游函数名、返回字段，保持响应结构一致（前端依赖既有字段）。

- [ ] **Step 2：冒烟测试（搜索）**

启动 server（见 Task 1.7），Run：
`curl -s 'http://127.0.0.1:<port>/api/search?keywords=test' | head -c 200`
Expected: 返回含 `result` 字段的 JSON（网络可用时）。

- [ ] **Step 3：提交**

```bash
git add server/routes/netease.ts
git commit -m "feat(server): port netease routes"
```

---

### Task 1.4：电台（podcast）路由

**Files:**
- Create: `server/routes/podcast.ts`
- Source: `server.js` 的 `/api/podcast/*` 与 `/api/podcast/dj-beatmap` 处理块。

**Interfaces:**
- Consumes: cookie API、`getBeatmapCacheDir`（1.2）、（DJ 分析占位，见下）。
- Produces: `export const podcastRoutes: RouteHandler`。

- [ ] **Step 1：移植 podcast 端点**，逐个对照 server.js。`/api/podcast/dj-beatmap` 涉及 BPM 节拍图缓存：缓存目录改用 `getBeatmapCacheDir(ctx)`；分析函数本阶段先 `import { analyzeBeatmap } from '../lib/beatmap-stub'`（返回空结构），阶段 3 完成 `dj-analyzer.ts` 后替换为真实实现并删除 stub。

- [ ] **Step 2：写占位 `server/lib/beatmap-stub.ts`**

```ts
export async function analyzeBeatmap(_audioUrl: string): Promise<{ bpm: number; beats: number[] }> {
  return { bpm: 0, beats: [] } // 阶段 3 替换为 dj-analyzer
}
```

- [ ] **Step 3：冒烟测试**

`curl -s 'http://127.0.0.1:<port>/api/podcast/hot' | head -c 200` → 返回 JSON。

- [ ] **Step 4：提交**

```bash
git add server/routes/podcast.ts server/lib/beatmap-stub.ts
git commit -m "feat(server): port podcast routes (beatmap stubbed)"
```

---

### Task 1.5：QQ 音乐 + 天气路由

**Files:**
- Create: `server/routes/qq-music.ts`, `server/routes/weather.ts`, `server/lib/proxy.ts`
- Source: `server.js` 的 `/api/qq/*`、`/api/weather/*`、`/api/cover`、`/api/audio` 处理块。

**Interfaces:**
- Produces: `export const qqRoutes: RouteHandler`、`export const weatherRoutes: RouteHandler`、`streamProxy(res, upstreamUrl, headers?)`（供 cover/audio 流式转发）。

- [ ] **Step 1：写 `server/lib/proxy.ts`**

```ts
import type { ServerResponse } from 'node:http'

export async function streamProxy(res: ServerResponse, upstreamUrl: string, headers: Record<string, string> = {}): Promise<void> {
  const upstream = await fetch(upstreamUrl, { headers })
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream'
  })
  if (upstream.body) {
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  }
  res.end()
}
```

- [ ] **Step 2：移植 qq-music 路由**，cookie 用 `getCookie(ctx,'qq')`；`/api/qq/login/cookie` 写入、`/api/qq/logout` 清除。

- [ ] **Step 3：移植 weather 路由**（Open-Meteo + IP 定位），逻辑与 server.js 一致，注意用 `fetch` 替代原 http 请求。

- [ ] **Step 4：cover/audio 走 `streamProxy`**（这两个端点归入 netease.ts 还是单列由实现者按 server.js 归属决定，保持行为一致即可）。

- [ ] **Step 5：冒烟测试**

`curl -s 'http://127.0.0.1:<port>/api/weather/ip-location' | head -c 200` → 返回定位 JSON。

- [ ] **Step 6：提交**

```bash
git add server/routes/qq-music.ts server/routes/weather.ts server/lib/proxy.ts
git commit -m "feat(server): port qq-music, weather routes and stream proxy"
```

---

### Task 1.6：更新检查与静态服务路由

**Files:**
- Create: `server/routes/update.ts`, `server/routes/static.ts`, `server/lib/update.ts`
- Source: `server.js` 的 `/api/app/version`、`/api/update/*`、`/api/beatmap/cache*` 处理块与顶部 `PATCH_ALLOWED_FILES`（第 71 行）、`mineradio.update` 配置。

**Interfaces:**
- Produces: `export const updateRoutes: RouteHandler`、`export const staticRoutes: RouteHandler`；`checkLatest()`、`downloadAsset()`、`verifyDigest()`、`applyPatch()`。

- [ ] **Step 1：写 `server/lib/update.ts`**，移植 GitHub Release 检查、镜像加速（`mineradio.update.mirrors`）、digest 校验、补丁应用（仅允许 `PATCH_ALLOWED_FILES`）。补丁可写文件名清单原样保留：`server.js`/`dj-analyzer.js` 在新项目中对应 `server/` 产物——**注意**：新架构补丁机制可能不适用（源已拆分），如不确定，本任务先实现「版本检查 + 安装包下载」，补丁热更新标记为 TODO 并在 PR 说明，**不要**静默删除该能力。

- [ ] **Step 2：写 `server/routes/update.ts` 与 `server/routes/static.ts`**。static 用 `public/` 目录，`/` → `index.html`，`/favicon.ico` 特判。

- [ ] **Step 3：冒烟测试**

`curl -s 'http://127.0.0.1:<port>/api/app/version'` → 返回版本 JSON。

- [ ] **Step 4：提交**

```bash
git add server/routes/update.ts server/routes/static.ts server/lib/update.ts
git commit -m "feat(server): port update-check and static routes"
```

---

### Task 1.7：Server 入口与路由编排

**Files:**
- Create: `server/index.ts`

**Interfaces:**
- Consumes: 所有 `*Routes`（1.3–1.6）。
- Produces: `export function startServer(ctx?: Partial<ServerContext>): Promise<{ port: number; close(): void }>`——供主进程内嵌调用；同时支持 `tsx server/index.ts` 直接启动。

- [ ] **Step 1：写 `server/index.ts`**

```ts
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerContext, RouteHandler } from './types'
import { neteaseRoutes } from './routes/netease'
import { podcastRoutes } from './routes/podcast'
import { qqRoutes } from './routes/qq-music'
import { weatherRoutes } from './routes/weather'
import { updateRoutes } from './routes/update'
import { staticRoutes } from './routes/static'
import { sendError } from './lib/http'

const chain: RouteHandler[] = [
  neteaseRoutes, podcastRoutes, qqRoutes, weatherRoutes, updateRoutes, staticRoutes
]

export function startServer(partial: Partial<ServerContext> = {}): Promise<{ port: number; close(): void }> {
  const ctx: ServerContext = {
    userDataDir: partial.userDataDir ?? join(tmpdir(), 'mineradio-next'),
    port: partial.port ?? 0
  }
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      try {
        for (const handler of chain) { if (await handler(req, res, url, ctx)) return }
        sendError(res, 404, 'Not Found')
      } catch (e) { sendError(res, 500, (e as Error).message) }
    })
    server.listen(ctx.port, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : ctx.port
      ctx.port = port
      resolve({ port, close: () => server.close() })
    })
  })
}

// 直接运行：tsx server/index.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer({ port: Number(process.env.PORT) || 35530 }).then(({ port }) =>
    console.log(`[server] listening on http://127.0.0.1:${port}`)
  )
}
```

- [ ] **Step 2：独立启动验证**

Run: `cd /Users/yangshenghao/github/Mineradio-Next && PORT=35530 npm run server:dev`
Expected: 打印 `[server] listening on http://127.0.0.1:35530`。

- [ ] **Step 3：端点抽查（另开终端）**

Run: `curl -s http://127.0.0.1:35530/api/app/version | head -c 120`
Expected: 返回版本 JSON。逐一抽查 search / weather / podcast 端点。

- [ ] **Step 4：typecheck**

Run: `npm run typecheck`
Expected: 无错误。

- [ ] **Step 5：提交**

```bash
git add server/index.ts
git commit -m "feat(server): server entry with route chain and standalone start"
```

---

> **阶段 1 完成判据：** `npm run server:dev` 独立启动；端点清单中所有路由均有实现且核心端点 curl 返回合理 JSON；`npm run typecheck` 通过；硬编码 `D:\\` 路径已消除。

---

# 阶段 2：Electron 主进程

**目标：** 把 `Mineradio/desktop/main.js`（1470 行）拆为模块化 TypeScript：窗口管理、IPC、平台适配、preload。主进程内嵌启动阶段 1 的 server。

**源文件：** `desktop/main.js`、`desktop/preload.js`、`desktop/overlay-preload.js`。

## 旧 IPC 通道 → 新通道映射（重要）

设计文档第 5 节定义了**新的命名规范**（`window:minimize` 等），而原项目用 `desktop-window-minimize` 等旧名。**新项目采用设计文档的新命名**，preload 负责把渲染层的语义化调用映射到新通道。下表为「设计文档新通道 ← 原 main.js handler（移植逻辑来源）」：

| 新通道（IpcChannels） | 原 handler（逻辑来源，main.js 行号） |
|---|---|
| `window:minimize` | `desktop-window-minimize` (1104) |
| `window:toggle-fullscreen` | `desktop-window-toggle-fullscreen` (1112) |
| `window:get-state` | `desktop-window-get-state` (1120) |
| `window:close` | `desktop-window-close` (1124) |
| `login:netease-open` | `netease-music-open-login` (1167) |
| `login:netease-clear` | `netease-music-clear-login` (1171) |
| `login:qq-open` | `qq-music-open-login` (1175) |
| `login:qq-clear` | `qq-music-clear-login` (1179) |
| `lyrics:set-enabled` | `mineradio-desktop-lyrics-set-enabled` (1208) |
| `lyrics:update` | `mineradio-desktop-lyrics-update` (1222) |
| `lyrics:set-lock` | `mineradio-desktop-lyrics-set-lock-state` (1266) |
| `lyrics:move-by` | `mineradio-desktop-lyrics-move-by` (1278) |
| `wallpaper:set-enabled` | `mineradio-wallpaper-set-enabled` (1296) |
| `wallpaper:update` | `mineradio-wallpaper-update` (1306) |
| `hotkeys:configure` | `mineradio-hotkeys-configure-global` (1128) |
| `file:export-json` | `mineradio-export-json-file` (1132) |
| `file:import-json` | `mineradio-import-json-file` (1150) |
| `app:restart` | `mineradio-restart-app` (1198) |
| `app:open-update` | `mineradio-open-update-installer` (1183) |

| 新事件（IpcEvents） | 原事件 |
|---|---|
| `window:state-changed` | `desktop-window-state` |
| `lyrics:lock-state-changed` | `mineradio-desktop-lyrics-lock-state` |
| `lyrics:enabled-state-changed` | `mineradio-desktop-lyrics-enabled-state` |
| `hotkey:triggered` | `mineradio-global-hotkey` |

> 原项目还有 `desktop-window-toggle-maximize`、`...exit-fullscreen-windowed`、若干桌面歌词内部通道（`set-dragging`/`set-pointer-capture`/`set-hot-bounds`）和 `mineradio-wallpaper-state` 事件未进入设计文档契约。这些是**实现细节**：移植时保留为主进程内部/overlay 专用通道（不进 `IpcChannels`），但功能不能丢——在对应任务中以内部通道实现。

## 文件结构（本阶段创建）

```
electron/
├── main.ts
├── server-host.ts          # 内嵌启动 server（startServer），注入 userData 路径
├── modules/
│   ├── window-manager.ts   # 主窗口创建、状态推送、最大化/全屏
│   ├── overlay-manager.ts  # 桌面歌词窗口 + 壁纸窗口生命周期
│   ├── login-manager.ts    # 网易/QQ 扫码登录 BrowserWindow
│   └── hotkey-manager.ts   # globalShortcut 注册/注销
├── ipc/
│   ├── index.ts            # registerIpc(ctx)：挂载全部 handler
│   ├── window.ts
│   ├── lyrics.ts
│   ├── wallpaper.ts
│   ├── login.ts
│   └── misc.ts             # hotkeys/file/app
├── platform/
│   ├── index.ts            # getPlatform(): PlatformAdapter
│   ├── win32.ts
│   └── darwin.ts
└── preload/
    ├── index.ts
    └── overlay.ts
```

---

### Task 2.1：IPC 类型契约

**Files:**
- Create: `src/types/ipc.ts`

**Interfaces:**
- Produces: `IpcChannels`、`IpcEvents`（设计文档第 5 节原样落地）+ 配套数据类型：`WindowState`、`LoginResult`、`OkResult`、`LyricsPayload`、`WallpaperPayload`、`HotkeyBinding`、`HotkeyResult`、`ExportPayload`、`FileResult`、`ImportResult`、`DisplayBounds`。

- [ ] **Step 1：写 `src/types/ipc.ts`**

把设计文档第 5 节的 `IpcChannels` / `IpcEvents` 原样复制，并补齐引用到的数据类型定义：

```ts
export interface WindowState {
  isMaximized: boolean
  isFullScreen: boolean
  isMinimized: boolean
  isFocused: boolean
  displayBounds: DisplayBounds | null
}
export interface DisplayBounds { x: number; y: number; width: number; height: number }
export interface OkResult { ok: boolean; message?: string }
export interface LoginResult { ok: boolean; cookie?: string; profile?: unknown }
export interface LyricsPayload { /* 对照 main.js desktop-lyrics-update 的 payload 字段补全 */ }
export interface WallpaperPayload { /* 对照 main.js wallpaper-update 的 payload 字段补全 */ }
export interface HotkeyBinding { action: string; accelerator: string }
export interface HotkeyResult { ok: boolean; failed?: string[] }
export interface ExportPayload { suggestedName?: string; data: unknown }
export interface FileResult { ok: boolean; filePath?: string; canceled?: boolean }
export interface ImportResult { ok: boolean; data?: unknown; canceled?: boolean }

// 设计文档第 5 节的 IpcChannels / IpcEvents 原样粘贴于此
```

> `LyricsPayload` / `WallpaperPayload` 的字段必须**对照 main.js** 实际 payload 补全（颜色、字号、位置、文本、行数据等），不要留空接口。

- [ ] **Step 2：typecheck** → `npm run typecheck` 通过。
- [ ] **Step 3：提交** `git commit -m "feat(electron): add ipc type contract"`

---

### Task 2.2：Platform 适配层

**Files:**
- Create: `electron/platform/index.ts`, `electron/platform/win32.ts`, `electron/platform/darwin.ts`
- Source: `main.js` 中 PowerShell `GetAsyncKeyState` 鼠标轮询、WorkerW 壁纸注入、`.lnk` 桌面快捷方式相关代码。

**Interfaces:**
- Produces: `PlatformAdapter`（设计文档第 6 节）+ `getPlatform(): PlatformAdapter`。

```ts
export interface PlatformAdapter {
  startMousePoller(onMiddleClick: () => void): void
  stopMousePoller(): void
  attachWallpaperToDesktop(hwnd: string): void
  ensureDesktopShortcut(): { ok: boolean }
}
```

- [ ] **Step 1：写 `electron/platform/index.ts`**

```ts
import type { PlatformAdapter } from './types' // 或就近内联定义
import { win32Adapter } from './win32'
import { darwinAdapter } from './darwin'

export function getPlatform(): PlatformAdapter {
  return process.platform === 'win32' ? win32Adapter : darwinAdapter
}
```

- [ ] **Step 2：写 `electron/platform/darwin.ts`（全降级）**

```ts
import type { PlatformAdapter } from './index'
export const darwinAdapter: PlatformAdapter = {
  startMousePoller() { console.info('[platform/darwin] mouse poller not supported') },
  stopMousePoller() {},
  attachWallpaperToDesktop() { console.info('[platform/darwin] wallpaper not supported') },
  ensureDesktopShortcut() { return { ok: false } }
}
```

- [ ] **Step 3：写 `electron/platform/win32.ts`**，移植 main.js 的 PowerShell 轮询、WorkerW 注入、`.lnk` 创建逻辑（保持原命令字符串/逻辑，只做 TS 化与封装）。

- [ ] **Step 4：typecheck 通过；提交**

```bash
git add electron/platform
git commit -m "feat(electron): platform adapter (win32 full, darwin fallback)"
```

---

### Task 2.3：窗口管理模块

**Files:**
- Create: `electron/modules/window-manager.ts`, `electron/server-host.ts`
- Source: `main.js` 主窗口创建、`desktop-window-state` 推送（行 132）、最大化/全屏切换逻辑。

**Interfaces:**
- Produces:
  - `createMainWindow(serverPort: number): BrowserWindow`
  - `getMainWindow(): BrowserWindow | null`
  - `pushWindowState()`（向渲染层 send `window:state-changed`）
  - `server-host.ts`：`bootServer(): Promise<number>`（调用 `startServer({ userDataDir: app.getPath('userData') })`，返回端口）

- [ ] **Step 1：写 `electron/server-host.ts`**

```ts
import { app } from 'electron'
import { startServer } from '../server/index'

let handle: { port: number; close(): void } | null = null
export async function bootServer(): Promise<number> {
  if (handle) return handle.port
  handle = await startServer({ userDataDir: app.getPath('userData') })
  return handle.port
}
export function shutdownServer(): void { handle?.close(); handle = null }
```

- [ ] **Step 2：写 `electron/modules/window-manager.ts`**，移植主窗口配置（无边框、preload 指向 `../preload/index.js`、加载渲染层 URL/文件并附带 `?port=<serverPort>` 或通过 preload 暴露端口），实现 `pushWindowState`（监听 `maximize`/`unmaximize`/`enter-full-screen`/`leave-full-screen`/`focus`/`blur` 推送状态）。

- [ ] **Step 3：提交**

```bash
git add electron/server-host.ts electron/modules/window-manager.ts
git commit -m "feat(electron): window manager and embedded server host"
```

---

### Task 2.4：Overlay / Login / Hotkey 模块

**Files:**
- Create: `electron/modules/overlay-manager.ts`, `electron/modules/login-manager.ts`, `electron/modules/hotkey-manager.ts`
- Source: main.js 对应区块（桌面歌词窗口行 ~860-1060、壁纸窗口、扫码登录窗口、`globalShortcut`）。

**Interfaces:**
- Produces:
  - overlay-manager：`setLyricsEnabled(enabled, payload)`、`updateLyrics(payload)`、`setLyricsLock(locked)`、`moveLyricsBy(dx,dy)`、`setWallpaperEnabled(enabled,payload)`、`updateWallpaper(payload)`，并在内部用 `getPlatform()` 处理鼠标轮询与桌面注入。
  - login-manager：`openNeteaseLogin(): Promise<LoginResult>`、`clearNeteaseLogin()`、`openQQLogin()`、`clearQQLogin()`。
  - hotkey-manager：`configureHotkeys(bindings: HotkeyBinding[]): HotkeyResult`（注册后触发时向主窗口 send `hotkey:triggered`）。

- [ ] **Step 1–3：** 逐模块移植 main.js 逻辑，平台相关一律经 `getPlatform()`。桌面歌词的内部通道（`set-dragging`/`set-pointer-capture`/`set-hot-bounds`）在 overlay-manager 内部用原通道名实现（overlay preload 专用，不进 IpcChannels）。
- [ ] **Step 4：提交** `git commit -m "feat(electron): overlay, login, hotkey managers"`

---

### Task 2.5：IPC 注册

**Files:**
- Create: `electron/ipc/index.ts`, `electron/ipc/window.ts`, `electron/ipc/lyrics.ts`, `electron/ipc/wallpaper.ts`, `electron/ipc/login.ts`, `electron/ipc/misc.ts`

**Interfaces:**
- Consumes: 2.3/2.4 各模块函数。
- Produces: `registerIpc(): void`——用**新通道名**（Task 2.1）`ipcMain.handle` 全部通道，handler 体内调对应模块。

- [ ] **Step 1：写各 ipc 文件**，例如 `electron/ipc/window.ts`：

```ts
import { ipcMain } from 'electron'
import { getMainWindow } from '../modules/window-manager'

export function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', () => { getMainWindow()?.minimize() })
  ipcMain.handle('window:toggle-fullscreen', () => {
    const w = getMainWindow(); if (w) w.setFullScreen(!w.isFullScreen())
  })
  ipcMain.handle('window:close', () => { getMainWindow()?.close() })
  ipcMain.handle('window:get-state', () => /* 返回 WindowState */ ({}))
}
```

其余 lyrics/wallpaper/login/misc 同理，按映射表把新通道接到模块函数。

- [ ] **Step 2：写 `electron/ipc/index.ts`** 聚合调用全部 `register*Ipc()`。
- [ ] **Step 3：提交** `git commit -m "feat(electron): register ipc handlers on new channels"`

---

### Task 2.6：Preload（主窗口 + overlay）

**Files:**
- Modify: `electron/preload/index.ts`, `electron/preload/overlay.ts`
- Source: `desktop/preload.js`、`desktop/overlay-preload.js`。

**Interfaces:**
- Produces: `window.desktop` 上的类型安全 API（供渲染层 `useDesktopBridge` 使用），方法名沿用原 preload 语义（`minimize`/`toggleFullscreen`/`setDesktopLyricsEnabled`/`onStateChange` 等），内部 invoke **新通道**。

- [ ] **Step 1：写 `electron/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  isDesktop: true,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  getState: () => ipcRenderer.invoke('window:get-state'),
  close: () => ipcRenderer.invoke('window:close'),
  openNeteaseLogin: () => ipcRenderer.invoke('login:netease-open'),
  clearNeteaseLogin: () => ipcRenderer.invoke('login:netease-clear'),
  openQQLogin: () => ipcRenderer.invoke('login:qq-open'),
  clearQQLogin: () => ipcRenderer.invoke('login:qq-clear'),
  setDesktopLyricsEnabled: (enabled: boolean, payload?: unknown) =>
    ipcRenderer.invoke('lyrics:set-enabled', { enabled, payload }),
  updateDesktopLyrics: (payload: unknown) => ipcRenderer.invoke('lyrics:update', payload),
  setWallpaperEnabled: (enabled: boolean, payload?: unknown) =>
    ipcRenderer.invoke('wallpaper:set-enabled', { enabled }),
  updateWallpaper: (payload: unknown) => ipcRenderer.invoke('wallpaper:update', payload),
  configureHotkeys: (bindings: unknown[]) => ipcRenderer.invoke('hotkeys:configure', bindings),
  exportJson: (payload: unknown) => ipcRenderer.invoke('file:export-json', payload),
  importJson: () => ipcRenderer.invoke('file:import-json'),
  restartApp: () => ipcRenderer.invoke('app:restart'),
  openUpdateInstaller: (filePath: string) => ipcRenderer.invoke('app:open-update', { filePath }),
  onStateChange: (cb: (s: unknown) => void) => {
    const l = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('window:state-changed', l)
    return () => ipcRenderer.removeListener('window:state-changed', l)
  },
  onHotkey: (cb: (p: unknown) => void) => {
    const l = (_e: unknown, p: unknown) => cb(p)
    ipcRenderer.on('hotkey:triggered', l)
    return () => ipcRenderer.removeListener('hotkey:triggered', l)
  },
  onDesktopLyricsLockState: (cb: (p: unknown) => void) => { /* lyrics:lock-state-changed */ return () => {} },
  onDesktopLyricsEnabledState: (cb: (p: unknown) => void) => { /* lyrics:enabled-state-changed */ return () => {} }
}
contextBridge.exposeInMainWorld('desktop', api)
export type DesktopApi = typeof api

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell-root')
  document.body.classList.add('desktop-shell')
})
```

- [ ] **Step 2：写 `electron/preload/overlay.ts`**，移植 `overlay-preload.js`（桌面歌词/壁纸窗口用，暴露 overlay 内部通道）。
- [ ] **Step 3：渲染层全局类型** 在 `src/types/ipc.ts` 或新建 `src/types/global.d.ts` 中声明 `declare global { interface Window { desktop: DesktopApi } }`。
- [ ] **Step 4：提交** `git commit -m "feat(electron): preload bridges on new channels"`

---

### Task 2.7：主进程入口装配

**Files:**
- Modify: `electron/main.ts`
- Source: `main.js` 的 `app.whenReady` 启动序列、AppUserModelId（仅 win32）、单实例锁等。

**Interfaces:**
- Consumes: `bootServer`、`createMainWindow`、`registerIpc`、`getPlatform`。

- [ ] **Step 1：改写 `electron/main.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { bootServer, shutdownServer } from './server-host'
import { createMainWindow } from './modules/window-manager'
import { registerIpc } from './ipc'

if (process.platform === 'win32') app.setAppUserModelId('com.mineradio.desktop')

app.whenReady().then(async () => {
  registerIpc()
  const port = await bootServer()
  createMainWindow(port)
})
app.on('window-all-closed', () => { shutdownServer(); if (process.platform !== 'darwin') app.quit() })
```

- [ ] **Step 2：启动验证** `npm run dev` → 窗口出现，DevTools console 调 `window.desktop.minimize()` 能最小化；`window.desktop.getState()` 返回状态对象。
- [ ] **Step 3：typecheck** 通过。
- [ ] **Step 4：提交** `git commit -m "feat(electron): assemble main process entry"`

> **阶段 2 完成判据：** `npm run dev` 起窗口，内嵌 server 端口注入渲染层；窗口控制/全屏/状态推送可用；登录窗口能打开；`npm run typecheck` 通过。

---

# 阶段 3：渲染层基础

**目标：** 建立 Zustand stores、核心 lib（audio-engine、lyric-parser、dj-analyzer）、hooks、类型。这是 UI 的地基，本阶段不做视觉组件。

**源文件：** `public/index.html`（26879 行，含全部播放/歌词/状态逻辑）、`dj-analyzer.js`（864 行）、`public/default-user-fx-archive.json`。

> **拆解方法：** index.html 是巨型单文件。先**通读**定位三块核心逻辑——音频播放（`<audio>` 或 AudioContext 控制、音质切换、加载 URL）、歌词解析与滚动、可视化 FX 参数与预设存档。把状态抽到 stores，纯函数抽到 lib，副作用抽到 hooks。UI 留到阶段 4。

## 文件结构（本阶段创建）

```
src/
├── types/
│   ├── domain.ts           # Track, Playlist, LyricLine, FxParams, PresetId, ...
│   └── global.d.ts         # window.desktop 声明（若 2.6 未建则此处建）
├── lib/
│   ├── api.ts              # fetch 封装：读取注入端口，拼 /api/* 请求
│   ├── audio-engine.ts     # 播放/暂停/seek/音量/加载（移植 index.html 音频逻辑）
│   ├── lyric-parser.ts     # LRC 解析 + 翻译对齐（移植）
│   └── dj-analyzer.ts      # 移植 dj-analyzer.js（BPM/节拍）
├── stores/
│   ├── player.ts
│   ├── visual.ts
│   ├── playlist.ts
│   ├── lyrics.ts
│   ├── settings.ts
│   └── window.ts
└── hooks/
    ├── useAudio.ts
    ├── useDesktopBridge.ts
    └── useWeather.ts
```

---

### Task 3.1：领域类型

**Files:**
- Create: `src/types/domain.ts`
- Source: 对照 index.html 中歌曲/歌单/歌词/FX 数据结构与 `default-user-fx-archive.json` 字段。

**Interfaces:**
- Produces: `Track`、`Playlist`、`LyricLine`、`LyricLayout`、`FxParams`、`FxSnapshot`、`PresetId`、`HotkeyBinding`（与 ipc.ts 复用）等。

- [ ] **Step 1：写类型**，关键约束：`PresetId` 用字符串字面量联合，枚举值取自 index.html 现有预设；`FxParams`/`FxSnapshot` 字段须与 `default-user-fx-archive.json` 对齐以保证存档兼容。
- [ ] **Step 2：typecheck 通过；提交** `git commit -m "feat(renderer): domain types"`

---

### Task 3.2：API 客户端

**Files:**
- Create: `src/lib/api.ts`

**Interfaces:**
- Consumes: 主进程注入的 server 端口（通过 `window.desktop` 或 URL query；与 2.3 的注入方式对齐）。
- Produces: `api.get<T>(path, params?)`、`api.post<T>(path, body?)`、`apiBase()`。

- [ ] **Step 1：写 `api.ts`**，从注入处读端口拼 `http://127.0.0.1:<port>`。
- [ ] **Step 2：单测** mock fetch 验证 URL 拼接正确。
- [ ] **Step 3：提交** `git commit -m "feat(renderer): api client"`

---

### Task 3.3：lyric-parser（TDD）

**Files:**
- Create: `src/lib/lyric-parser.ts`, `src/lib/lyric-parser.test.ts`
- Source: index.html 中 LRC 解析与翻译对齐逻辑。

**Interfaces:**
- Produces: `parseLrc(text: string): LyricLine[]`、`alignTranslation(main, trans): LyricLine[]`。

- [ ] **Step 1：先写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { parseLrc } from './lyric-parser'

describe('parseLrc', () => {
  it('parses timestamped lines', () => {
    const out = parseLrc('[00:01.50]hello\n[00:03.00]world')
    expect(out).toEqual([
      { time: 1.5, text: 'hello' },
      { time: 3.0, text: 'world' }
    ])
  })
  it('ignores metadata tags', () => {
    expect(parseLrc('[ar:foo]\n[00:00.00]hi')).toEqual([{ time: 0, text: 'hi' }])
  })
})
```

- [ ] **Step 2：运行 → FAIL**（`npx vitest run src/lib/lyric-parser.test.ts`）。
- [ ] **Step 3：实现** `parseLrc`/`alignTranslation`（移植 index.html 逻辑）。
- [ ] **Step 4：运行 → PASS。**
- [ ] **Step 5：提交** `git commit -m "feat(renderer): lyric parser with tests"`

---

### Task 3.4：dj-analyzer 移植（TDD）

**Files:**
- Create: `src/lib/dj-analyzer.ts`, `src/lib/dj-analyzer.test.ts`
- Source: `dj-analyzer.js`（864 行，BPM/节拍分析）。

**Interfaces:**
- Produces: 与 `dj-analyzer.js` 对外函数等价的 TS 接口（如 `analyzeBeatmap(samples|url): { bpm, beats }`，以源文件实际导出为准）。

- [ ] **Step 1：读 `dj-analyzer.js` 确定导出契约。**
- [ ] **Step 2：写测试**（用已知 BPM 的合成信号断言估计值在容差内）。
- [ ] **Step 3：移植实现**（保持算法一致，仅 TS 化）。
- [ ] **Step 4：运行测试 → PASS。**
- [ ] **Step 5：替换 server 占位** —— 把 `server/routes/podcast.ts` 中 `beatmap-stub` 改为引用真实 `dj-analyzer`（注意 server 为 Node 端，若 dj-analyzer 依赖浏览器 API 需提供 Node 适配或在 server 侧用等价实现），删除 `server/lib/beatmap-stub.ts`。
- [ ] **Step 6：提交** `git commit -m "feat: port dj-analyzer and wire into podcast route"`

---

### Task 3.5：audio-engine

**Files:**
- Create: `src/lib/audio-engine.ts`
- Source: index.html 音频播放逻辑（含 `mpg123-decoder` 用法、音质切换、URL 加载、进度/时长事件）。

**Interfaces:**
- Produces: `class AudioEngine`：`load(url)`、`play()`、`pause()`、`seek(s)`、`setVolume(v)`、事件回调 `onPosition`/`onDuration`/`onEnded`/`onStatus`。

- [ ] **Step 1：移植实现**，事件以回调暴露（store 在 3.6 订阅）。
- [ ] **Step 2：typecheck 通过；提交** `git commit -m "feat(renderer): audio engine"`

---

### Task 3.6：Zustand stores

**Files:**
- Create: `src/stores/player.ts`, `visual.ts`, `playlist.ts`, `lyrics.ts`, `settings.ts`, `window.ts`
- Source: 设计文档第 4 节（接口定义）+ index.html 状态逻辑。

**Interfaces:**
- Produces: 六个 store，接口**严格按设计文档第 4 节**。`player` 内部持有 `AudioEngine` 实例并把回调映射到 `position`/`duration`/`status`；`visual` 的 `saveArchive`/`loadArchive` 与 `default-user-fx-archive.json` 兼容；`settings` 的 `saveToLocal`/`loadFromLocal` 用 `localStorage`，`exportArchive`/`importArchive` 产出兼容 JSON；`window` 只读，由 `useDesktopBridge` 推送。

- [ ] **Step 1：逐个建 store**，签名与设计文档第 4 节一致（方法名不得改：`loadTrack`、`setPreset(id,{commitPlayback})`、`updateFx`、`saveArchive`、`loadArchive`、`loadUserPlaylists`、`next`/`prev`、`setLines`、`tick`、`updateLayout`、`saveToLocal`/`loadFromLocal`/`exportArchive`/`importArchive`）。
- [ ] **Step 2：单测**：player 的 `loadTrack→play` 状态流转；settings 的 export/import 往返；lyrics 的 `tick` 推进 `currentIndex`。
- [ ] **Step 3：运行测试 → PASS；提交** `git commit -m "feat(renderer): zustand stores"`

---

### Task 3.7：hooks

**Files:**
- Create: `src/hooks/useDesktopBridge.ts`, `src/hooks/useAudio.ts`, `src/hooks/useWeather.ts`

**Interfaces:**
- Produces:
  - `useDesktopBridge()`：挂载时订阅 `window.desktop.onStateChange`→写入 `window` store，`onHotkey`→分发到 player 动作；返回桥接方法。
  - `useAudio()`：把 `player` store 与 `AudioEngine` 生命周期绑定（卸载清理）。
  - `useWeather()`：调 `/api/weather/*` 拉天气电台。

- [ ] **Step 1：实现三个 hook。**
- [ ] **Step 2：联通验证** 在 `App.tsx` 临时调用 `useDesktopBridge()`，`npm run dev` 后窗口最大化/还原能更新 `window` store（DevTools 观察）。
- [ ] **Step 3：提交** `git commit -m "feat(renderer): bridge/audio/weather hooks"`

> **阶段 3 完成判据：** lib 单测全绿（lyric-parser、dj-analyzer、stores）；audio-engine 可加载播放一首歌（DevTools 手动验证）；server 的 beatmap 占位已替换；`npm run typecheck` 通过。

---

# 阶段 4：UI 组件

**目标：** 用阶段 3 的 stores/hooks 搭出完整可交互界面，对齐 index.html 的视觉与交互。

**源文件：** `public/index.html`（UI/CSS/Three.js 场景/交互全部在此）、`public/assets`、`public/vendor`。

> **通用规则：** 每个组件 = `Xxx.tsx` + `Xxx.module.css`；只从 store 读状态、调 store action，不在组件里放业务逻辑；Three.js 组件用 `@react-three/fiber`（`<Canvas>` + 声明式）重写 index.html 的命令式 Three 代码。视觉效果以**对齐原观感**为准。

## 任务划分（按组件组，每组一个任务）

每个任务结构相同：① 读 index.html 对应区块 → ② 建组件+module.css → ③ 接 store → ④ `npm run dev` 目视验证 → ⑤ 提交。下面列出每任务的文件与验收点。

---

### Task 4.1：UI 原子组件 + 全局样式

**Files:** `src/components/ui/GlassPanel.tsx`、`Slider.tsx`、`Toggle.tsx`（各配 `.module.css`）；`src/styles/global.css`（reset + 字体 + CSS 变量，从 index.html `<style>` 提取全局变量与字体）；在 `src/main.tsx` 引入 global.css。
**验收：** Storybook 不需要；在 App 临时渲染三个原子组件，样式正确、Slider 可拖、Toggle 可切。
**提交：** `feat(ui): atoms and global styles`

---

### Task 4.2：Layout（标题栏 + 窗口外壳）

**Files:** `src/components/Layout/TitleBar.tsx`、`WindowChrome.tsx`（+css）。
**接线：** TitleBar 按钮调 `window.desktop.minimize/toggleFullscreen/close`；WindowChrome 读 `window` store 显示最大化/全屏态。
**Source:** index.html 顶部自定义标题栏与 `-webkit-app-region: drag` 处理。
**验收：** 拖动标题栏移动窗口；最小化/全屏/关闭按钮生效。
**提交：** `feat(ui): titlebar and window chrome`

---

### Task 4.3：Player（播放栏）

**Files:** `src/components/Player/PlayerBar.tsx`、`TrackInfo.tsx`、`QualityBadge.tsx`、`PlayerGlass.tsx`（+css）。
**接线：** 全部读 `player` store；进度条 seek→`player.seek`；音量→`setVolume`；音质徽标读 `quality`；播放/暂停/上一首/下一首接 `player` 与 `playlist`。
**Source:** index.html 播放控制区。
**验收：** 选中一首歌（可临时硬编码 Track）能播放、暂停、seek、调音量，进度与时长实时更新。
**提交：** `feat(ui): player bar`

---

### Task 4.4：Search（搜索）

**Files:** `src/components/Search/SearchBar.tsx`、`SearchResults.tsx`（+css）。
**接线：** SearchBar 调 `api.get('/api/search')`（网易）/`/api/qq/search`（按 `player.source`）；结果点击→`player.loadTrack` + 加入 `playlist.queue`。
**Source:** index.html 搜索框与结果列表。
**验收：** 输入关键词→出结果→点击→开始播放（全链路）。
**提交：** `feat(ui): search`

---

### Task 4.5：Lyrics（舞台歌词）

**Files:** `src/components/Lyrics/StageLyrics.tsx`、`LyricLine.tsx`（+css）。（`DesktopLyrics.tsx` 放阶段 5。）
**接线：** 读 `lyrics` store；`useAudio`/player 的 position 驱动 `lyrics.tick`；当前行高亮 + 平滑滚动；显示翻译行（若有）。
**Source:** index.html 舞台歌词区与滚动动画（可用 gsap）。
**验收：** 播放时歌词随进度滚动、当前行高亮、翻译对齐。
**提交：** `feat(ui): stage lyrics`

---

### Task 4.6：Visualizer（粒子可视化 + 预设）

**Files:** `src/components/Visualizer/Scene.tsx`、`ParticleCloud.tsx`、`SkullPreset.tsx`、`CinemaCamera.tsx`、`presets/*`（+必要 css）。
**接线：** 读 `visual` store（`preset`/`fx`/`performanceMode`）；用 `@react-three/fiber` `<Canvas>` 渲染；FX 参数变化实时反映；预设切换走 `visual.setPreset`；音频频谱数据从 `audio-engine` 取（如 AnalyserNode）驱动粒子。
**Source:** index.html 的 Three.js 场景、粒子系统、骷髅预设、影院相机、各 preset。
**验收：** 默认预设渲染粒子云；切预设生效；随音乐律动；`performanceMode` 切换影响粒子量/帧率。
**提交：** `feat(ui): three.js visualizer and presets`

> 这是工作量最大的任务；如单任务过大，可按子组件再拆（ParticleCloud / SkullPreset / CinemaCamera 各一提交），但保持每次提交可运行。

---

### Task 4.7：Shelf（3D 歌单架）

**Files:** `src/components/Shelf/ShelfScene.tsx`、`ShelfCard.tsx`、`ShelfDetail.tsx`（+css）。
**接线：** 读 `playlist` store（`playlists`/`shelfVisible`/`shelfMode`）；`loadUserPlaylists` 拉 `/api/user/playlists`；卡片点击→`ShelfDetail` 展示曲目→点击曲目播放。
**Source:** index.html 3D 歌单架场景与详情。
**验收：** 登录后歌单架显示用户歌单；动态/静态模式切换；进入详情并播放其中曲目。
**提交：** `feat(ui): 3d shelf`

---

### Task 4.8：Settings（设置面板）

**Files:** `src/components/Settings/SettingsPanel.tsx`、`VisualSettings.tsx`、`HotkeySettings.tsx`、`AccountSettings.tsx`（+css）。
**接线：**
- VisualSettings → `visual.updateFx`/`setPreset`/`saveArchive`/`loadArchive`、`performanceMode`/`backgroundMode`。
- HotkeySettings → `settings.hotkeys` + `window.desktop.configureHotkeys`。
- AccountSettings → `window.desktop.openNeteaseLogin/clearNeteaseLogin/openQQLogin/clearQQLogin`，读 `settings.neteaseLoggedIn/qqLoggedIn`；导入导出走 `window.desktop.exportJson/importJson`（兼容存档）。
- **壁纸/桌面歌词中键开关在 macOS 上禁用并显示「仅 Windows 支持」**（读 `window.desktop.isDesktop` + 平台判断；平台信息可由 preload 暴露 `process.platform`）。
**Source:** index.html 设置面板各分区。
**验收：** 改 FX 实时生效并能存/取存档；配置快捷键生效；登录态正确显示；导入导出与原项目存档互通；macOS 上壁纸开关禁用并有提示。
**提交：** `feat(ui): settings panel`

---

### Task 4.9：App 总装

**Files:** Modify `src/App.tsx`（+`App.module.css`）。
**接线：** 组合 Layout + Visualizer（背景层）+ Shelf + StageLyrics + PlayerBar + Search + SettingsPanel；顶层调 `useDesktopBridge()`、`useAudio()`，启动时 `settings.loadFromLocal()`。
**验收：** 完整界面呈现；搜索→播放→歌词→可视化→设置全链路在一个窗口内可用。
**提交：** `feat(ui): assemble app`

> **阶段 4 完成判据：** 主窗口功能与原项目对齐（搜索/播放/歌词/可视化/歌单架/设置/登录/存档）；`npm run typecheck` 通过；目视验收各任务通过。

---

# 阶段 5：Overlays（桌面歌词 + 壁纸）

**目标：** 实现两个独立 Vite 入口窗口，由主进程 overlay-manager（阶段 2.4）创建并通过 overlay preload（2.6）通信。

**源文件：** `public/desktop-lyrics.html`、`public/wallpaper.html`、`desktop/overlay-preload.js`。

---

### Task 5.1：桌面歌词 overlay

**Files:** `overlays/desktop-lyrics/desktop-lyrics.html`（已占位，补内容）、`overlays/desktop-lyrics/index.tsx`、`overlays/desktop-lyrics/DesktopLyrics.tsx`（或复用 `src/components/Lyrics/DesktopLyrics.tsx`）+ css。
**接线：** 通过 overlay preload 接收 `lyrics:update` 内容、锁定/启用状态；拖动/移动调内部通道（`set-dragging`/`move-by`）；Windows 上中键切换由主进程鼠标轮询触发。
**验收（Windows）：** 主窗口开启桌面歌词→桌面层出现歌词、随播放更新；锁定后穿透；中键切换显隐；拖动可移动并经 `lyrics:move-by` 持久化。
**验收（macOS）：** 中键轮询禁用（仅主窗口按钮控制），歌词窗口仍可显示更新。
**提交：** `feat(overlay): desktop lyrics`

---

### Task 5.2：壁纸 overlay

**Files:** `overlays/wallpaper/wallpaper.html`（补内容）、`overlays/wallpaper/index.tsx` + 复用 Visualizer 场景 + css。
**接线：** 接收 `wallpaper:update` 同步可视化参数；Windows 经 `attachWallpaperToDesktop` 注入桌面层（WorkerW）。
**验收（Windows）：** 开启壁纸模式→可视化作为桌面壁纸渲染并随音乐律动。
**验收（macOS）：** 设置中该功能禁用（阶段 4.8 已处理），不创建窗口。
**提交：** `feat(overlay): wallpaper`

> **阶段 5 完成判据：** Windows 上桌面歌词与壁纸均工作；macOS 上正确降级不报错；`npm run typecheck` 通过。

---

# 阶段 6：平台适配与打包

**目标：** 配置 electron-builder，产出 macOS DMG（x64+arm64 Universal）与 Windows NSIS 安装包。

**源文件：** `Mineradio/package.json` 的 `build` 段、`Mineradio/build/`（图标、NSIS 脚本、after-pack）。

---

### Task 6.1：构建资源与图标

**Files:** Create `build/`（`icon.icns`、`icon.ico`、`icon.png`、必要时 `entitlements.mac.plist`）。
**步骤：**
- [ ] 复制/生成图标：`icon.png` → `icon.icns`（macOS）与 `icon.ico`（Windows）。
- [ ] 从原项目移植所需 NSIS 资源（如沿用 NSIS 安装界面），不需要的 Windows 专属脚本在 mac 配置中不引用。
- [ ] 提交 `chore(build): icons and build resources`

---

### Task 6.2：electron-builder 配置

**Files:** Modify `package.json`（新增 `build` 段）或新建 `electron-builder.yml`。
**步骤：**
- [ ] 配置 `appId: com.mineradio.desktop`、`productName: Mineradio`、`directories.output: dist`、`files`（指向 `out/**` 构建产物 + `public`）。
- [ ] `mac`: `target: dmg`，`arch: [x64, arm64]`（或 universal），`icon: build/icon.icns`，`category: public.app-category.music`。
- [ ] `win`: `target: nsis`，`arch: [x64]`，`icon: build/icon.ico`，移植原 `nsis` 段。
- [ ] 移植 `mineradio.update`（GitHub provider/镜像）配置（供阶段 1.6 更新逻辑读取）。
- [ ] 提交 `chore(build): electron-builder config for mac and win`

---

### Task 6.3：出包验证

**步骤：**
- [ ] **macOS（在 mac 上）：** `npm run build:mac` → `dist/` 生成 `.dmg`；安装运行，验证搜索/播放/歌词/可视化可用，壁纸与中键功能显示「仅 Windows 支持」。
- [ ] **Windows（在 Windows 或 CI 上）：** `npm run build:win` → 生成 NSIS `.exe`；安装运行，验证含桌面歌词与壁纸的全功能。
- [ ] 提交（若有配置修正）`chore(build): finalize packaging`

> **阶段 6 完成判据：** 两平台均能出包并运行核心功能；macOS 降级提示正确。

---

# 全局自检清单（计划完成后逐条核对）

对照设计文档逐节确认有任务覆盖：

- [ ] **§3 目录结构**：所有文件/目录都在某任务中创建（electron/src/overlays/server/build/配置）。
- [ ] **§4 Stores**：六个 store 接口由 Task 3.6 实现，方法名一致。
- [ ] **§5 IPC 契约**：`IpcChannels`/`IpcEvents` 由 2.1 定义、2.5 实现、2.6 桥接。
- [ ] **§6 Platform 接口**：`PlatformAdapter` 由 2.2 实现（win32 完整 / darwin 降级）。
- [ ] **§7 Mac 适配**：壁纸禁用、中键禁用、图标 icns、DMG —— 分散在 2.2 / 4.8 / 5.x / 6.x 覆盖。
- [ ] **§8 Server**：路由全覆盖（1.3–1.6）；`BEATMAP_CACHE_DIR` 硬编码 bug 已修（1.2）；存档兼容（3.1/3.6/4.8）。
- [ ] **§9 构建脚本**：`dev/build/build:win/build:mac` 在 0.1 与 6.2 配齐。
- [ ] **§10 范围外**：未引入新功能、未做 Tauri、未做 server 完整单测套件。

# 验证矩阵

| 验证类型 | 命令 | 适用阶段 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 每阶段末 |
| 单元测试 | `npx vitest run` | 1（lib）、3（lib/stores） |
| Server 冒烟 | `npm run server:dev` + curl | 1 |
| 应用启动 | `npm run dev` | 2、3、4、5 |
| 打包 | `npm run build:mac` / `build:win` | 6 |

# 风险与注意

1. **index.html 拆解（最高风险）**：26879 行单文件，逻辑高度耦合。务必先通读定位「音频 / 歌词 / 可视化 / 状态」四大块再动手，避免边拆边漏。Visualizer（4.6）从命令式 Three 改声明式 r3f 是难点，必要时再拆子任务。
2. **dj-analyzer 跨端（3.4）**：原文件若依赖浏览器 AudioContext，而 server 端（podcast 路由）也要用，需评估 Node 侧可行性；不可行则 server 侧保留等价计算、渲染层用浏览器版。
3. **补丁热更新（1.6）**：原项目按文件名打补丁的机制在「源已拆分+打包」的新架构下可能失效。先实现版本检查+安装包下载，热更新降级为 TODO 并在 PR 注明，**不要静默删能力**。
4. **存档兼容（贯穿）**：FxParams/Snapshot 字段必须与 `default-user-fx-archive.json` 严格对齐，否则用户老存档无法导入。
5. **macOS 全屏/无边框**：无边框窗口在 mac 上的红绿灯按钮与 `trafficLightPosition`、全屏行为需实测调整。

---

> **执行入口：** 建议用 `superpowers:subagent-driven-development`——每任务派新 subagent，任务间复审。阶段 1（Server）可与阶段 2/3 并行启动。
