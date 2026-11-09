# 音源探索模块与实时预览验收

目标分支 `dev/2.7.0`，功能分支 `feature/explore-modules`，最终核对日期 2026-11-06。此次仅同步开发代码与文档，不升级版本、合入 master、打标签或发布。

## 实现范围

用户入口、模块清单、存档和账号边界统一见 [探索页模块设置](../explore-modules.md)。网易云、QQ、Apple、酷狗和汽水共用模块编辑及只读实时预览；哔哩哔哩暂无探索模块，保留封面专属设置。Apple 地区选项保留。

各音源独立开关、鼠标拖动排序、自动保存和恢复默认；只挂载已开启模块。面板向齿轮左侧覆盖并内部滚动，停用音源时收起且禁用入口，偏好不清空。预览复用实际探索内容、隔离封面转场并随账号 session 重建，不能触发播放或跳转。画布使用当前窗口宽度且至少 1280px，修复 QQ 多列推荐把说明挤成竖排的问题。

「推荐与发现」和 Apple「推荐与榜单精选」仍为组合模块，内部未进一步拆分，不支持安装第三方插件。

## 最终自动验证

- `npm run typecheck` 通过。
- 全量 `npm test`：432 个测试文件通过，4078 个用例通过，2 个既有用例跳过。
- 配置归一化、去重、跨平台隔离、旧配置兼容、开关与排序重载保留、关闭模块不挂载、禁用音源不可设置、全关恢复路径均有回归用例。
- 提交前发现 `setExploreLayout` 遗漏后台命令白名单，已补齐。新增 [宿主持久化回归](../../src/lib/playback-explore-settings.test.ts) 先失败（命令被拒绝），修复后通过，覆盖真实宿主命令、快照、存档和重载。
- UI 机械检查无发现；复验脚本语法检查及 `git diff --check` 通过。
- 功能、画布宽度修复及持久化补齐均完成独立只读复核，无阻塞问题。

## 实际界面与交互

在独立 userData 的 macOS Electron dev 中验证，使用 CDP 固定逻辑视口，不操作真实平台账号，不播放音乐。

| 检查范围 | 结果与证据 |
|---|---|
| 网易云深浅主题、1536×864 / 960×540 | 模块开关、首尾拖动及边缘自动滚动、只读点击、内部滚动、关闭卸载、恢复默认通过；[结果](assets/2026-11-06-explore-preview/verification.json)、[脚本](checks/explore-modules-preview.cjs) |
| QQ / Apple / 酷狗 / 汽水 × 深浅主题 × 两种尺寸，共 16 场景 | 各平台专属模块开关和实际预览挂载同步，真实拖动后预览 DOM 顺序同步，停用后入口禁用；画布内部无横向溢出，QQ 说明区保留横排宽度；[结果](assets/2026-11-06-platform-previews/verification.json)、[脚本](checks/explore-platform-previews.cjs) |
| 账号会话及旧响应 | 模拟酷狗从账号切回游客，音源保持启用时预览重建，旧账号在途请求晚到不覆盖新会话 |
| 面板与动效 | Esc 返回齿轮焦点，关闭按钮可用，打开期间停用音源立即收起；减少动态和关闭弹层/拖动动效后仍可操作 |
| 真实后台保存与应用恢复 | 使用真实客户端代理和后台设置通道，仅启用汽水游客的本机内容，鼠标修改开关与排序；后台状态、localStorage、主窗口快照一致。主窗口重载及退出后冷启动均保留；[结果](assets/2026-11-06-explore-preview/persistence.json)、[脚本](checks/explore-modules-persistence.cjs) |

界面及跨账号检查使用模拟内容；最后的持久化检查不模拟设置通道，也不调用平台登录或播放。前期仅本地 store 的模拟界面检查不足以证明后台保存，最终以真实后台通道及冷启动检查补齐。

## 截图

| 平台 | 代表截图 |
|---|---|
| 网易云 | [深色大窗口](assets/2026-11-06-explore-preview/dark-1536x864.png)、[浅色最小窗口](assets/2026-11-06-explore-preview/light-960x540.png) |
| QQ | [深色大窗口](assets/2026-11-06-platform-previews/qq-dark-1536x864.png)、[浅色最小窗口](assets/2026-11-06-platform-previews/qq-light-960x540.png) |
| Apple | [深色大窗口](assets/2026-11-06-platform-previews/apple-dark-1536x864.png)、[浅色最小窗口](assets/2026-11-06-platform-previews/apple-light-960x540.png) |
| 酷狗 | [深色大窗口](assets/2026-11-06-platform-previews/kugou-dark-1536x864.png)、[浅色最小窗口](assets/2026-11-06-platform-previews/kugou-light-960x540.png) |
| 汽水 | [深色大窗口](assets/2026-11-06-platform-previews/qishui-dark-1536x864.png)、[浅色最小窗口](assets/2026-11-06-platform-previews/qishui-light-960x540.png) |

网易截图记录实时预览初版；其他四平台截图包含最终画布宽度修复。更早的不含实时预览的模块面板截图保留在 `assets/2026-11-05-explore-modules/`，仅用于追溯，不代表最终界面。

## 剩余边界

尚未验证 Windows/Linux、真实平台账号返回的大量内容、平台加载失败状态和真实播放。模拟截图不代表平台登录或真实内容请求成功；未生成同环境的修改前截图，不宣称像素级前后对比完成。没有构建安装包或执行发布操作。
