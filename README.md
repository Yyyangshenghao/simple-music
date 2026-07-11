# Simple Music

一个基于 Electron + React 的桌面音乐播放器，支持网易云音乐与 QQ 音乐双音源，内置沉浸式可视化、桌面歌词、动态壁纸等能力。

> **免责声明**：本项目为个人学习与技术交流用途，非网易云音乐、腾讯 QQ 音乐官方产品，也不隶属或代表网易、腾讯及其关联公司。项目中涉及的音源接口为对公开 Web/客户端接口的技术性调用，不提供任何音乐内容的存储或分发。请勿用于商业用途，因使用本项目产生的任何版权或法律纠纷由使用者自行承担。若相关权利方认为本项目存在侵权内容，请联系作者，将第一时间处理。

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
npm run build:mac        # 打包 macOS（build:win 同理）
```

更多架构与模块说明见 [`CLAUDE.md`](./CLAUDE.md) 与 [`docs/modules/`](./docs/modules/)。

## 鸣谢

- [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)（MIT，Binaryify）—— 网易云音乐接口封装，作为直接依赖使用。
- QQ 音乐接口部分在实现与文档整理时参考、交叉核对了以下开源逆向项目（均未直接引入代码，接口来源见 [`docs/qq-music-api.md`](./docs/qq-music-api.md)）：
  - [l-1124/QQMusicApi](https://github.com/l-1124/QQMusicApi)（Python）
  - [copws/qq-music-api](https://github.com/copws/qq-music-api)（JS）
  - [jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi)（Node.js）

以上项目均为非官方逆向实现，QQ 音乐、网易云音乐无面向个人开发者的公开 OpenAPI，相关接口存在随上游改版失效的风险。

## License

[MIT](./LICENSE) © yshAM
