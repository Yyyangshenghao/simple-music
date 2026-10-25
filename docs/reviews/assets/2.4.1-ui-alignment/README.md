# 2.4.1 非设置页 UI 对齐：前后截图素材

Codex 已独立复核；本目录保存开发阶段原始截图与机器生成的清单，对比结论和保留项见上两级的 `2.4.1-ui-alignment-comparison.md`。后续歌手空间调整见 `2.4.1-artist-header-space.md`。

## 文件

- `before/`：基准 `bd10077`（源码未改）截图 52 张与 `manifest.json`。
- `after/`：本分支工作树（未提交）截图 52 张与 `manifest.json`，记录拍摄时的未提交文件列表。
- `index.json`：前后同名截图配对，附灰度差像素占比（仅供定位）。
- `interactions.json`：交互验收结果、设置源码差异检查与页面错误。

命名为 `<场景>--<主题>-<宽>x<高>.png`。核心场景各 4 张（深/浅 × 1536×864/960×540），空结果与失败状态各 2 张（深色 1536、浅色 960）。

## 重放

脚本在 `docs/reviews/checks/`：`ui-alignment-2.4.1.cjs`（截图）与 `ui-alignment-2.4.1-interactions.cjs`（交互）。

```bash
npx electron-vite dev --remoteDebuggingPort 9461 -- --user-data-dir=<新建空目录>
```

```bash
NODE_PATH=<含 playwright 的 node_modules> node docs/reviews/checks/ui-alignment-2.4.1.cjs after
```

```bash
NODE_PATH=<含 playwright 的 node_modules> node docs/reviews/checks/ui-alignment-2.4.1-interactions.cjs
```

截图脚本第二个参数可指定逗号分隔的场景名局部重拍，结果并入同一 `manifest.json` 的 `reruns`。`OUTPUT_DIR` 可改写输出目录。

## 固定条件

- 平台数据全部为模拟数据：网易云与 QQ 已登录并启用，Apple Music 关闭；service 未提供 fixture 的方法一律拒绝，`/api/*` 平台端点拦截为 503（`unexpectedApi` 只是被拦截的请求，没有真实数据进入页面）。
- CDP 固定视口与 `deviceScaleFactor=1`；问候语固定为下午，`Math.random` 固定种子；截图前有限动画跳到终态、循环动画冻结；指针停在左侧中下部，返回按钮处于自动躲藏后的静止态。
- 滚动/视图时间线动画不参与 settle：早期版本对所有动画 `finish()`，把歌手工具栏的 `follow-scroll`（ScrollTimeline）推到吸顶终态，导致 `artist`、`artist-description-open` 截图里工具栏压在歌手信息上方。修正后这两个场景的 before/after 各 4 张已重拍（before 在临时 clean `bd10077` 工作区拍摄），截图后断言 `scrollTop=0` 时工具栏位于歌手信息之下；其他场景原图未变。取证见 `artist-toolbar-settle-evidence.json`，重放脚本 `docs/reviews/checks/ui-alignment-2.4.1-artist-toolbar-evidence.cjs`。
- 已知噪声：氛围背景流体（WebGL）每次渲染略有差异；每日推荐卡日期取当天日期。
