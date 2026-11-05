/**
 * 谁负责画窗口右上角的最小化/最大化/关闭。
 *
 * macOS 用系统交通灯（titleBarStyle: hiddenInset）；Windows 与 Linux 的主窗口都是
 * frame: false，按钮由 WindowChrome 自绘。凡是自绘按钮的平台，顶栏右侧都必须留出
 * 同样宽度的占位，否则按钮会压住顶栏的头像、任务入口等控件（Linux 曾因此点头像
 * 直接命中最右边的关闭按钮）。
 */
export function drawsCaptionButtons(platform: string | undefined): boolean {
  return Boolean(platform) && platform !== 'darwin'
}
