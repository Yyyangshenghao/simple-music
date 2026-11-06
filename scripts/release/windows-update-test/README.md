# Simple Music 2.6.2 → 2.7.0 本地更新测试

此套件不发布 Release。新版标为 TEST，程序内部版本为 2.7.0；与正式版使用相同 appId、安装登记和用户数据。请复制到一次性 Windows 虚拟机，在虚拟机内操作。不要用日常电脑已有的正式安装做这两轮测试。

## 建立共同起点

1. 安装 `Simple-Music-2.6.2-ORIGINAL-Setup.exe`，这是正式 Release 的原始包。
2. 建议安装到 `C:\SM-Upgrade-Test\Simple Music`。打开应用，修改主题或音量，建测试歌单，然后从托盘完全退出。
3. 用记事本在安装目录创建 `保留测试.txt`，在 `resources` 中创建 `保留测试.txt`。这些都必须在更新和卸载后保留。
4. 保存虚拟机快照。后面两轮都从这个快照开始，不要直接降级覆盖。

## 第一轮：手动 Setup 更新

1. 双击 `Simple-Music-2.7.0-TEST-Setup.exe`，核对它显示的最终安装位置后安装。
2. 从更新后的桌面或开始菜单快捷方式启动，确认关于页显示 2.7.0，之前的设置、歌单和两个测试文件仍在。
3. 检查 Windows「已安装的应用」只有预期的安装记录，登记版本为 2.7.0。
4. 从「已安装的应用」卸载，确认新版程序被移除，测试文件与旧版目录仍在。旧版无文件归属清单，当前策略会保留其程序文件。

## 第二轮：真实应用内更新

1. 恢复共同起点快照，确保 2.6.2 完全退出。
2. 双击 `启动应用内更新测试.cmd`。它只为本次启动指定本地更新源，不修改系统环境变量，不伪造应用版本。
3. 在 2.6.2 内进入「设置 → 关于」，检查更新、下载，然后点击「重启并安装」。
4. 确认旧进程退出，安装静默执行，新版自动启动；关于页和安装登记都应为 2.7.0。
5. 检查设置、歌单、两个测试文件，以及快捷方式指向的路径。
6. 卸载验收建议分两个快照分支：一次从系统「已安装的应用」卸载；恢复到更新后，再运行旧目录里的卸载器，确认它也定位到新版。两次都检查测试文件保留。
7. 完成后双击 `停止测试更新服务.cmd`；服务最多运行两小时，只监听 127.0.0.1，不向局域网开放。

## 预期路径与测试范围

旧版没有归属清单时，新版预计位于原目录的 `Simple Music-2.7.0` 子目录，名称冲突时加编号。旧文件不会被自动清理；升级后要从更新后的快捷方式启动，不要手动运行旧目录里留下的 2.6.2 exe。

本地更新清单提供真实文件大小和 SHA-256。服务只提供更新清单和测试 Setup，不允许任意路径读取。只需 Windows 自带 PowerShell，不依赖 Node/Python。

测试包未做生产 VMP 签名。本套件用于 Windows 更新、文件保留及卸载验收，不能代表 Apple Music DRM 的发布验收。不要把此测试包当正式 2.7.0 分发。

若应用没有提示 2.7.0，先确认托盘旧进程已退出且是从测试启动器启动；不要修改正式更新配置或发布一个假 Release 来触发测试。

## 维护者重新生成套件

从官方 `v2.6.2` Release 下载 `Simple-Music-2.6.2-Setup.exe`，保存到仓库的 `dist/update-test/Simple-Music-2.6.2-ORIGINAL-Setup.exe`。其官方 SHA-256 为 `652b36131458def1d42de68a70cfdc7bbd25a14ba621972afddbfe21187ecb87`，组装脚本会再次核验。

在仓库根目录依次执行：

```bash
npx electron-vite build --config scripts/release/windows-update-test/vite.config.mjs
node scripts/release/windows-update-test/prepare.mjs --config
npx electron-builder --win nsis --publish never --config dist/update-test/builder.json
node scripts/release/windows-update-test/prepare.mjs --assemble
node scripts/release/windows-update-test/check.mjs
```

输出为 `dist/update-test/kit`。测试配置仅在编译和打包阶段覆盖版本，不改仓库 `package.json`；关于页、更新 API 与安装器内部版本均为 2.7.0。`check.mjs` 在另一个回环端口启动服务、完整下载并核对摘要，随后停止服务，不启动或安装应用。

beta 通道另由 `server/lib/update-channel.test.ts` 验证：同号正式版高于 beta、beta 数字排序、正式版拒绝 beta、自定义清单与备用线路一致。2.6.2 → 2.7.0 套件实际验证的是稳定版跨版本安装链路，不冒充 beta → beta 的实际安装验收。
