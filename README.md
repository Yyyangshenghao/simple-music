# Simple Music

**把喜欢的音乐放在一起，让听歌回到听歌本身。**

Simple Music 是一款支持网易云音乐、QQ 音乐、Apple Music 与本地文件的桌面播放器。从每日推荐里遇见新歌，从歌手页继续探索，或打开整屏歌词，让封面、文字和音乐一起流动。

支持 **macOS 与 Windows**。在线平台需要分别登录并启用，歌曲与音质的可用范围取决于账号权限和平台服务。

[下载安装](https://github.com/Yyyangshenghao/simple-music/releases/latest) · [首次使用](#首次使用) · [功能与边界](#功能与边界) · [2.3.4 更新日志（开发中）](./docs/release-notes-2.3.4.md) · [参与开发](#参与开发)

## 界面一览

以下画面来自 macOS 上的 2.3.4 开发分支，使用作者已登录的网易云账号与平台真实内容，在播放颜人中《My love》时直接截取。封面、推荐与歌词均来自实际使用，未使用模拟数据。点击图片可查看原图。

### 一首歌，一整屏的陪伴

[![正在播放颜人中《My love》：真实封面、同步歌词与封面氛围背景](./docs/screenshots/2.3.4/lyrics.jpg)](./docs/screenshots/2.3.4/lyrics.jpg)

普通歌词跟随播放进度滚动，逐字高亮当前一句；想换个氛围，也可以切到封面粒子与立体文字组成的 3D 舞台。

| 探索音乐 · 从真实推荐开始 | 3D 歌词 · 让音乐拥有舞台 |
|---|---|
| [![真实账号探索页：每日推荐、私人雷达与发现歌单](./docs/screenshots/2.3.4/explore.jpg)](./docs/screenshots/2.3.4/explore.jpg) | [![《My love》实际播放中的封面粒子与 3D 歌词](./docs/screenshots/2.3.4/lyrics-3d.jpg)](./docs/screenshots/2.3.4/lyrics-3d.jpg) |
| 每日推荐、私人雷达与歌单叠卡，接着熟悉的听歌口味继续发现。 | 同一首歌、同一份歌词，在有深度的空间里呈现。 |

| 歌手页 · 顺着喜欢继续听 | 歌单详情 · 把下一首安排好 |
|---|---|
| [![颜人中歌手页：真实头像、简介、热门单曲与专辑入口](./docs/screenshots/2.3.4/artist.jpg)](./docs/screenshots/2.3.4/artist.jpg) | [![真实账号的每日推荐歌单与正在播放的《My love》](./docs/screenshots/2.3.4/playlist.jpg)](./docs/screenshots/2.3.4/playlist.jpg) |
| 看简介、听热门单曲，再从专辑或相似歌手找到新的方向。 | 搜索歌单内的歌曲、整理队列，或把可保存的歌曲留下来离线听。 |

截图展示开发中的界面，正式版本以 Releases 为准；推荐内容随账号与日期变化。截图来源见 [拍摄记录](./docs/screenshots/2.3.4/README.md)。

## 下载安装

前往 [Releases](https://github.com/Yyyangshenghao/simple-music/releases/latest)，选择适合自己电脑的安装包。

| 系统 | 下载文件 | 安装方式 |
|---|---|---|
| macOS · Apple 芯片 | `Simple-Music-<version>-arm64.dmg` | 打开镜像，将应用拖入「应用程序」 |
| macOS · Intel 芯片 | `Simple-Music-<version>-x64.dmg` | 同上 |
| Windows · x64 安装版 | `Simple-Music-<version>-Setup.exe` | 按安装向导操作，推荐日常使用 |
| Windows · x64 便携版 | `Simple-Music-<version>-portable.exe` | 双击运行，更新时手动下载新版 |

Mac 的芯片类型可在苹果菜单 →「关于本机」查看。应用内「设置 → 关于应用」提供检查更新入口；macOS 下载后需要手动完成安装包替换，Windows 便携版需要自行更新。

## 首次使用

1. **连接音乐平台**：打开「设置 → 音源与账户」，登录想使用的平台，再打开对应启用开关。Apple Music 需要有效订阅才能播放完整歌曲。
2. **开始找歌**：使用顶栏搜索，或进入「探索」「我的库」浏览推荐、歌单与收藏。页面右侧的平台切换入口控制探索和我的库的内容来源。
3. **听自己的音乐**：进入「我的库 → 本地音乐」，点击「添加文件夹」。本地文件无需在线账号；应用会读取内嵌标签、封面和同名 `.lrc` 歌词。
4. **调成自己的习惯**：在设置里选择音质、主题、歌词字体和快捷键，再按需要启用桌面歌词、迷你播放条或动态壁纸。

在线平台的登录与启用状态相互独立。账号失效时可回到设置重新登录；已有本地文件与已保存的离线音乐仍可使用。

## 日常听歌

### 找歌与整理

- **探索与我的库**：按平台浏览推荐、收藏与歌单；搜索支持歌曲、歌手、专辑与歌单，可按类型及平台筛选。搜索历史保存在本机，详情返回后保留筛选与滚动位置。
- **歌手与专辑**：查看歌手简介、热门单曲、专辑与相似歌手；在歌曲列表中搜索，或从播放栏的歌手名字直接跳转。
- **漫游与刷歌**：沿歌手关系探索、生成漫游歌单，或逐首试听推荐歌曲。
- **播放队列**：设为下一首、调整顺序、移除曲目，搭配断点续播与睡眠定时。

### 随时看歌词

- 歌词页提供普通歌词与 3D 舞台，支持逐字高亮、翻译和音译；具体内容取决于歌词来源。
- 桌面歌词支持单行／双行、字体调整、宽度自适应与锁定；迷你播放条适合腾出主窗口空间。
- 深浅主题、封面氛围色、可视化场景与动态壁纸可按喜好调整，视觉参数支持存档导入和导出。
- 应用内快捷键、全局快捷键及系统媒体键可在设置中配置。

### 为离线听歌做准备

网易云与 QQ 曲目可通过播放栏菜单的「保存到本地」保存完整音频，随后在「我的库 → 离线音乐」搜索、排序与播放。缓存目录、容量及清理选项位于设置中。

自动播放缓存与主动保存的离线歌曲分开管理：自动缓存可能被容量清理淘汰，想长期离线收听的歌曲应主动保存。Apple Music 不支持音频下载或离线保存。

## 功能与边界

| 来源 | 账号与播放 | 音质与离线 |
|---|---|---|
| 网易云音乐、QQ 音乐 | 分别登录并启用；播放受版权、会员与接口状态限制 | 可选音质，实际以账号可用档位为准；支持完整音频缓存与离线保存 |
| Apple Music | 有效订阅及可用连接；使用独立受保护播放会话 | 不提供音质档位、倍速或离线保存 |
| 本地音乐 | 添加电脑上的音乐文件夹，无需在线账号 | 读取本机原文件，不参与在线平台的音频接力 |

网易云与 QQ 的「播放接力」可在当前平台无法播放时，按设置顺序尝试其他已启用平台的同曲版本；是否找到可播版本取决于平台权限与匹配结果。Apple Music 不参与跨平台音频替换，歌词缺失时可以从已启用平台匹配同曲歌词。

Apple Music 的可视化频谱取决于系统是否允许捕获受保护音频；无法捕获时仍可正常播放。在线接口可能随平台改版失效，本项目不保证所有平台功能始终可用。

## 更新日志与反馈

**2.3.4 开发中**：重点改善搜索历史、详情返回、歌手页和歌词排版，并修复刷歌控制、播放恢复、本地音乐与应用更新中的问题。完整范围与待验事项见 [2.3.4 更新日志](./docs/release-notes-2.3.4.md)。

点击「设置 → 关于应用 → 更新日志」，进入独立页面，按新增、优化、修复等类别查看当前版本与历史版本的变化，也可阅读兼容说明。记录离线可读，旧版本可展开查看。新版本的安装包和发行说明发布在 [Releases](https://github.com/Yyyangshenghao/simple-music/releases)。

遇到问题或有功能建议，请前往 [Issues](https://github.com/Yyyangshenghao/simple-music/issues)。反馈问题时附上应用版本、系统与芯片类型、复现步骤，以及相关截图或日志。

## 参与开发

使用 Electron（CastLabs ECS）、React、TypeScript、Zustand、electron-vite 与 Three.js。

```bash
npm ci
npm run dev           # 启动桌面应用，内嵌 API 随主进程运行
npm run typecheck     # 检查主进程与渲染层类型
npm test              # 运行测试
npm run build         # 构建源码，不生成安装包
```

独立 API 调试可用 `npm run server:dev`（默认端口 `35530`）。开发模式下，Apple Music 受保护播放使用本机 Chrome；正式安装包通过 CastLabs EVS 签名后使用应用内窗口。

实现入口见 [文档导航](./docs/README.md)，分支与提交规则见 [协作规范](./CONTRIBUTING.md)，安装包、版本升级和发布流程见 [构建与发布](./docs/build-and-release.md)。

## 免责声明

本项目为个人学习与技术交流用途，不是网易云音乐、QQ 音乐或 Apple Music 的官方产品，也不代表相关平台。项目不托管或分发音乐内容；音频缓存与离线保存发生在使用者本机。请遵守所用平台的服务条款与适用法律。若相关权利方认为本项目存在侵权内容，请联系作者处理。

## 鸣谢与来源

- **[XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)（GPL-3.0）**—— 本项目的起点。Simple Music 最初是这个项目的移植式重写：整体架构（Electron 主进程模块化、React + TypeScript 渲染层、electron-vite 构建、跨平台适配）已经完全重写，但 `server/lib/dj-analyzer.ts` 的 BPM/节拍分析算法、`electron/platform/win32.ts` 的桌面壁纸注入与鼠标轮询脚本、`server/routes/*` 部分接口的业务逻辑，是在保留原有算法/逻辑的前提下移植为 TypeScript 的，属于 GPLv3 意义上的衍生代码。这也是本项目 license 是 GPL-3.0 而不是更宽松协议的原因。
- [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)（MIT，Binaryify）—— 网易云音乐接口封装，作为直接依赖使用。
- QQ 音乐接口部分在实现与文档整理时参考、交叉核对了以下开源逆向项目（均未直接引入代码，接口来源见 [QQ 音乐接口文档](./docs/qq-music-api.md)）：[l-1124/QQMusicApi](https://github.com/l-1124/QQMusicApi)（Python）、[copws/qq-music-api](https://github.com/copws/qq-music-api)（JS）、[jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi)（Node.js）。

以上项目均为非官方逆向实现，QQ 音乐、网易云音乐无面向个人开发者的公开 OpenAPI，相关接口存在随上游改版失效的风险。

## License

[GPL-3.0](./LICENSE) © yshAM

沿用参考项目 [Mineradio](https://github.com/XxHuberrr/Mineradio) 的 GPL-3.0 协议：可以自由使用、修改、分发，但基于本项目的二次分发（包括分发编译后的安装包）也必须遵循 GPL-3.0，公开对应源码。
