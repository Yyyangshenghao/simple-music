## 更新日志

- 修复：修复 Apple Music 账号地区与播放网页地区不一致。
- 修复：修复 Apple Music 播放时 3D 歌词缺少音频响应。
- 新增：支持 Apple Music 音频频谱采集，驱动可视化效果。
- 优化：更新使用说明、架构文档、播放说明与代理协作指南。

## 兼容说明

- 不涉及设置或缓存格式迁移，已有账号、本地音乐和离线文件继续保留。
- Apple Music 音频频谱采集取决于系统及受保护媒体的捕获能力；采集不可用时仍可正常播放。正式安装包仍需要 EVS streaming VMP 生产签名。

## 验证情况

- `npm run typecheck`、`npm test`（133 个测试文件、1063 项测试）、`npm run build` 与 `git diff --check` 通过。
- 文档链接与文中代码路径已核对；`npm run dev` 成功启动开发服务与 Electron。未使用真实 Apple Music 订阅执行 DRM 长播，也未在 Windows 上人工检查音频捕获与 3D 歌词效果。
