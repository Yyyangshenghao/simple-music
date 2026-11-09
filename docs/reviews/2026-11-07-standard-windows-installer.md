# Windows 标准安装器：研究与简化

目标版本：`dev/2.7.0`。工作分支：`feature/windows-install-scope`，从 `adcba32` 创建。维护者要求安装器接近常见 Windows 应用，减少视觉与流程定制，并关注卸载误删其他文件的问题。本记录替代上一轮“只恢复范围页”的实现范围；不表示已经生成或验收安装包。

## 官方实现参考

核对日期：2026-11-07。以下基于官方仓库源码，不表示运行过这些应用的当前安装包，也不将热门项目中的每一条清理命令视为安全范例。

| 软件 | 可核对事实 | 本项目采用的方向 |
| --- | --- | --- |
| [VS Code 安装脚本](https://github.com/microsoft/vscode/blob/main/build/win32/code.iss) | 使用 Inno Setup 标准向导；User/System 构建分别选择用户程序目录、Program Files 和权限。文件由 `[Files]` 声明，额外清理单列于 `[UninstallDelete]` | 标准页面、明确安装范围与默认路径；不照搬它的双安装包分发或应用专属清理规则 |
| [Notepad++ 安装脚本](https://github.com/notepad-plus-plus/notepad-plus-plus/blob/master/PowerEditor/installer/nppSetup.nsi)及[卸载脚本](https://github.com/notepad-plus-plus/notepad-plus-plus/blob/master/PowerEditor/installer/nsisInclude/uninstall.nsh) | 使用 NSIS MUI 标准目录、进度、完成和卸载确认页；主程序按文件名删除，安装根最后用非递归 `RMDir` 清理。部分插件/数据子目录仍递归清理 | 复用原生页面；卸载只处理本应用文件并清理空目录，不照搬插件目录递归删除 |
| [VLC 安装脚本](https://github.com/videolan/vlc/blob/master/extras/package/win32/NSIS/vlc.win32.nsi.in) | 使用标准 MUI 页面；安装记录 `uninstall.log`，卸载读取记录逐文件删除，再移除空目录 | 文件归属清单与空目录清理；不直接复用外部日志读取代码或其其他递归清理 |

[Inno Setup 官方文档](https://jrsoftware.org/ishelp/topic_uninstalldeletesection.htm)明确反对通过通配符删除整个应用目录：用户可能放入额外数据，也可能选错目录。可借鉴的核心是文件归属和删除边界，并非换个工具名称就自然安全。

框架扩展点按 Context7 的 electron-builder、NSIS 官方文档核对，并与本地锁定依赖的 `assistedInstaller.nsh`、`multiUserUi.nsh`、`uninstaller.nsh` 及 MUI2 `Directory.nsh` / `UninstallConfirm.nsh` 对照。

## 本仓证据与边界

- 本地 electron-builder 的默认卸载分支在没有 `customRemoveFiles` 时执行 `RMDir /r $INSTDIR`；更新分支还会遍历整个目录移出文件。若应用与其他文件共用安装目录，这种“整个目录归本应用”的假设存在误删风险。
- `9fa87df` 之前的自定义安装脚本没有 `customRemoveFiles`；当前主线已加入构建文件清单、目录联接检查、逐文件删除和空目录清理，也禁止升级调用旧卸载器。
- 这说明必须保留现有安全覆盖，不能为“回到标准”直接删掉所有自定义逻辑。但没有事故安装包及实际安装路径，尚不能把用户报告的误删完整归因于某个版本或操作步骤。
- 自定义配色、字体、侧栏和布局增加维护面积，但没有证据表明这些视觉设置直接执行了误删。此次同时减少视觉复杂度并保留删除边界。

## 最小实施范围

继续使用现有 NSIS 安装包与更新协议，不迁移 Inno Setup、不新增 MSI、不改变应用数据位置。

1. 安装使用原生范围页 → 原生目录页 → 原生进度页 → 原生完成页。新安装默认当前用户，全用户安装沿用原生 UAC 提权。
2. 去掉自定义 `nsDialogs` 页面、字体、颜色、标题栏覆盖、按钮着色、重复路径预览和完成页定制；保留应用图标及必要的文件影响说明。
3. 删除横幅、侧栏位图和生成脚本，以及配置中的对应引用。仅删除配置不足以关闭素材：electron-builder 还会按默认文件名自动发现这些图片。
4. 通过已有扩展点插入单个原生 `MUI_PAGE_DIRECTORY`；关闭打包器的自动目录页，防止重复插入。页面离开时使用现有路径规范化、目录冲突与归属判断；若目标改变，更新原生输入框、提示并停留，要求再次确认。
5. 卸载使用原生欢迎页和范围选择，欢迎页说明额外文件保留范围；根据已有 `--delete-app-data` 参数显示是否删除播放器数据。默认保留播放器数据，不增加新的数据删除选项。
6. 保留安装事务、校验、备份恢复、旧版隔离迁移、进程检查与逐文件卸载模块。

原生提权后的内层进程会跳过范围选择页；若要从已提权的全用户流程改回当前用户安装，需要退出并重新启动安装器。此行为沿用依赖模板。

## 验证与未验收范围

- 再次核对 Windows 安装/卸载页面及 macOS/Linux 影响：8 个文件、90 项回归通过，覆盖安装文件归属、进程保护、三平台原生库打包筛选、更新资产选择、更新通道、清理及安装交接。macOS 更新替换测试实际运行 bash，验证正常替换与失败回滚。这些结果不代表真实安装包或原生 UI 已验收。
- 结构化比较 `package.json`：排除 `build.nsis` 后与基准完全相同，macOS/Linux/portable 和共享配置未变。
- 直接调用 darwin/Linux 构建钩子：Windows 清单生成器均提前返回，不访问 Windows 输出路径；macOS 生产 VMP 签名显式跳过，Linux 不进入任一平台签名。独立跨平台复核未发现回归或安全宏遗漏。
- 提交前 `npm run typecheck` 通过；全量 `npm test`：442 个文件通过，4198 项通过、2 项跳过。`git diff --check` 通过。
- 独立复核发现：将原生卸载确认页插在范围选择前，双范围共存时确认路径可能与最终目标不同。已改为原生欢迎页，仅说明数据边界；由后续原生范围页显示选择位置，避免提前确认错误目录。独立复核已回看修正，最终静态复核未发现阻断问题。
- 遵循默认不编译的约定，没有执行应用构建或生成安装包；当前 macOS 环境也无法实测 Windows 原生窗口。没有使用还原图片代替实机验收。
- 维护者要求先集成 dev；发包前仍需在一次性 Windows 环境检查：当前用户与所有用户的默认路径、快捷方式和注册表；UAC 同意与取消；双范围共存时卸载目标选择；目录页后退；盘符/父目录调整后的再次确认；无效与被占用目录；覆盖升级与静默升级；卸载后根目录及 resources 中的额外文件保留。原有 CI 路径与安装脚本仍须执行。

维护者已明确授权将本次 feature 通过本地 Squash 合入 `dev/2.7.0`，主工作区保持 dev 供后续测试。本次仅集成开发代码，不推送、不升级版本、不合入 master、不打 tag 或发布。
