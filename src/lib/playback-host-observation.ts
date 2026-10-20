// 可视化按需开租约；后台播放本身不持有采集流或频谱刷新循环。
let spectrumRequested = false
let shortcutBlocked = false
export function setPlaybackSpectrumRequested(requested: boolean): void { spectrumRequested = requested }
export function isPlaybackSpectrumRequested(): boolean { return spectrumRequested }
export function setPlaybackShortcutBlocked(blocked: boolean): void { shortcutBlocked = blocked }
export function isPlaybackShortcutBlocked(): boolean { return shortcutBlocked }
