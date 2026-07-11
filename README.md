# Simple Music

一个基于 Electron + React 的桌面音乐播放器，支持网易云音乐与 QQ 音乐双音源，内置沉浸式可视化、桌面歌词、动态壁纸等能力。

> **免责声明**：本项目为个人学习与技术交流用途，非网易云音乐、腾讯 QQ 音乐官方产品，也不隶属或代表网易、腾讯及其关联公司。项目中涉及的音源接口为对公开 Web/客户端接口的技术性调用，不提供任何音乐内容的存储或分发。请勿用于商业用途，因使用本项目产生的任何版权或法律纠纷由使用者自行承担。若相关权利方认为本项目存在侵权内容，请联系作者，将第一时间处理。

## 下载

前往 [Releases](https://github.com/Yyyangshenghao/simple-music/releases/latest) 下载对应平台的安装包。

### macOS

先确认自己的芯片：苹果菜单 →「关于本机」看「芯片」一栏，或终端执行 `uname -m`（输出 `arm64` 是 Apple 芯片，`x86_64` 是 Intel）。

| 芯片 | 下载哪个 |
|---|---|
| Apple 芯片（M1 / M2 / M3 / M4 及以后） | `SimpleMusic-<version>-arm64.dmg` |
| Intel 芯片（2020 年及更早的 Mac） | `SimpleMusic-<version>.dmg`（不带 `arm64` 后缀的那个） |

装错芯片版本会直接提示「无法打开」或需要靠 Rosetta 转译运行，性能明显更差，请对号下载。

### Windows

| 版本 | 下载哪个 | 适合场景 |
|---|---|---|
| 安装版（推荐） | `SimpleMusic-<version>-Setup.exe` | 标准安装向导，建开始菜单/桌面快捷方式，支持卸载，也是软件内「检查更新」默认走的那条路径 |
| 便携版 | `SimpleMusic-<version>-portable.exe` | 免安装，双击直接运行，不写注册表/开始菜单，适合 U 盘携带或不想装应用的场景；更新需要手动重新下载覆盖，不参与自动安装流程 |

## 功能

- 网易云音乐 / QQ 音乐双音源，登录、搜索、歌单、歌手页、每日推荐/私人雷达（网易专属）
- 沉浸式 Three.js 可视化场景、桌面歌词悬浮窗、动态壁纸悬浮窗
- 浅色/深色双主题，视觉 FX 参数可调并支持存档导入导出
- 全局热键、窗口状态同步、跨平台（macOS 优先，Windows 同时支持）

## 技术栈

Electron + React 18 + TypeScript + Zustand + electron-vite + Three.js（`@react-three/fiber`）

## 开发

```bash
npm install
npm run dev            # electron-vite 开发模式
npm run build           # 构建到 out/
npm run typecheck        # 类型检查
npm test                # vitest 测试
npm run build:mac        # 打包 macOS（x64 + arm64 dmg）
npm run build:win        # 打包 Windows（安装版 + 便携版）
```

更多架构与模块说明见 [`CLAUDE.md`](./CLAUDE.md) 与 [`docs/modules/`](./docs/modules/)。

## 鸣谢

- **[XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)（GPL-3.0）**—— 本项目的起点。Simple Music 最初是这个项目的移植式重写：整体架构（Electron 主进程模块化、React + TypeScript 渲染层、electron-vite 构建、跨平台适配）已经完全重写，但 `server/lib/dj-analyzer.ts` 的 BPM/节拍分析算法、`electron/platform/win32.ts` 的桌面壁纸注入与鼠标轮询脚本、`server/routes/*` 部分接口的业务逻辑，是在保留原有算法/逻辑的前提下移植为 TypeScript 的，属于 GPLv3 意义上的衍生代码。这也是本项目 license 是 GPL-3.0 而不是更宽松协议的原因。
- [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)（MIT，Binaryify）—— 网易云音乐接口封装，作为直接依赖使用。
- QQ 音乐接口部分在实现与文档整理时参考、交叉核对了以下开源逆向项目（均未直接引入代码，接口来源见 [`docs/qq-music-api.md`](./docs/qq-music-api.md)）：
  - [l-1124/QQMusicApi](https://github.com/l-1124/QQMusicApi)（Python）
  - [copws/qq-music-api](https://github.com/copws/qq-music-api)（JS）
  - [jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi)（Node.js）

以上项目均为非官方逆向实现，QQ 音乐、网易云音乐无面向个人开发者的公开 OpenAPI，相关接口存在随上游改版失效的风险。

## License

[GPL-3.0](./LICENSE) © yshAM

沿用参考项目 [Mineradio](https://github.com/XxHuberrr/Mineradio) 的 GPL-3.0 协议：可以自由使用、修改、分发，但基于本项目的二次分发（包括分发编译后的安装包）也必须遵循 GPL-3.0，公开对应源码。
