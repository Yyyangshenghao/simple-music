# TopBar 布局重构设计文档

**日期：** 2026-06-29  
**状态：** 待实现

## 背景

当前布局采用左侧 52px 竖向图标条（LeftStrip），窗口配置为 `frame: false` + `transparent: true`（完全自定义窗口，无原生系统按钮）。目标是改为类 Apple Music 的横向顶部导航栏，并启用 macOS 原生 traffic lights。

## 目标

1. 启用 macOS 原生 traffic lights（红/黄/绿关闭/缩小/最大化按钮）
2. 将纵向 LeftStrip 改为横向 TopBar
3. 将设置和音源切换收进头像下拉菜单，简化主导航
4. 保持 PlayerBar、AppShell 内部页面、歌词面板不变

---

## 一、Electron 窗口配置

**文件：** `electron/modules/window-manager.ts`

### 变更

| 字段 | 旧值 | 新值 |
|------|------|------|
| `frame` | `false` | 移除（默认 true） |
| `transparent` | `true` | `false` |
| `backgroundColor` | `'#00000000'` | `'#0a101c'`（深色底，与 `--sm-bg-base` 匹配） |
| `titleBarStyle` | 无 | `'hiddenInset'` |
| `trafficLightPosition` | 无 | `{ x: 16, y: 14 }` |

### 补充 IPC

在 `electron/ipc/window.ts` 添加：
```ts
ipcMain.handle('window:maximize', () => {
  const win = getMainWindow()
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
```

在 `electron/preload/index.ts` 的 `window` 对象里添加：
```ts
maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
```

---

## 二、WindowChrome 简化

**文件：** `src/components/Layout/WindowChrome.tsx` / `WindowChrome.module.css`

窗口不再透明，原有玻璃圆角边框失效。WindowChrome 简化为纯深色背景容器，边框/圆角/阴影由 macOS 原生处理。

`.chrome` 样式改为：
```css
.chrome {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--sm-bg-base);
}
```

移除 `.focused`、`.fullScreen` 中与玻璃效果相关的 `border`、`border-radius`、`box-shadow`。全屏时继续铺满即可（`border-radius: 0` 本就是默认）。

---

## 三、TopBar 组件

**新建文件：** `src/components/Layout/TopBar.tsx` / `TopBar.module.css`

### 布局（高度 44px）

```
|←── ~80px traffic lights 留白（drag） ──→|← 后退 →|←── drag ──→|← 探索  我的库 →|←── drag ──→|← 搜索 →|← 头像 →|
```

- **整条 TopBar** 设 `-webkit-app-region: drag`
- 所有交互元素（按钮、输入框）单独设 `-webkit-app-region: no-drag`

### 左区

- 约 80px 左 padding 留给 traffic lights（`titleBarStyle: 'hiddenInset'` 下系统按钮浮在此区域）
- `←` 后退按钮：调用 `navigation.goBack()`，当 `history.length === 0` 时 disabled

### 中区（居中）

- `探索` | `我的库` 两个 Tab 按钮
- 对应 `AppView`: `'explore'` | `'library'`
- active 状态：字重加粗 + accent 颜色，非 active 半透明
- 点击调用 `navigation.navigateTo(view)`

### 右区

- **搜索框**：compact 输入框（宽约 160px），展开/收起动效，触发现有搜索逻辑
- **头像按钮**：点击切换下拉菜单（`AvatarMenu`）的显示/隐藏

---

## 四、头像下拉菜单（AvatarMenu）

**新建文件：** `src/components/Layout/AvatarMenu.tsx` / `AvatarMenu.module.css`

点击头像后在头像下方弹出 popover，包含三个区块：

### 1. 来源切换

两个单选按钮（radio 样式）：网易云 / QQ音乐，切换当前 source，复用现有 SourceModule 的状态逻辑。

### 2. 账号设置

入口行，点击后在 popover 内 inline 展开（不跳转页面）：
- **网易云**：显示已登录用户名 + 「退出登录」按钮 / 未登录时显示「登录」按钮
- **QQ音乐**：同上
- 退出登录调用各来源现有的登出 IPC

### 3. 设置

一行入口，点击调用 `navigation.navigateTo('settings')`，关闭 popover。

---

## 五、布局重构

**文件：** `src/App.tsx`、`src/App.module.css`、`src/components/Layout/AppShell.module.css`

### App.tsx

```tsx
return (
  <WindowChrome>
    <div className={styles.root}>
      <TopBar />
      <AppShell />
      <PlayerBar onOpenLyrics={() => setLyricsOpen(true)} />
      <LyricsPanel open={lyricsOpen} onClose={() => setLyricsOpen(false)} />
    </div>
  </WindowChrome>
)
```

移除 `<LeftStrip />`，移除 `styles.content` 包裹层。

### App.module.css

```css
.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--sm-bg-base);
}
```

移除 `.content`。

### AppShell

去掉原来与 LeftStrip 并排的 flex row 布局，AppShell 直接占满剩余空间（`flex: 1; overflow: hidden`）。

---

## 六、删除 / 清理

- `src/components/Layout/LeftStrip.tsx` — 删除
- `src/components/Layout/LeftStrip.module.css` — 删除
- `src/components/Layout/modules/NavModule.tsx` / `.css` — 删除（逻辑迁入 TopBar）
- `src/components/Layout/modules/SearchModule.tsx` / `.css` — 删除（逻辑迁入 TopBar 搜索框）
- `src/components/Layout/modules/SourceModule.tsx` / `.css` — 删除（逻辑迁入 AvatarMenu）
- `src/components/Layout/modules/AccountModule.tsx` / `.css` — 删除（逻辑迁入 TopBar 头像）
- `src/components/Layout/modules/useHoverPanel.ts` — 删除（hover panel 模式不再使用）

---

## 七、范围外（不动）

- PlayerBar 内部逻辑
- 歌词面板（LyricsPanel、DesktopLyrics、StageLyrics）
- AppShell 内各页面（ExplorePage、LibraryPage、SettingsPage、ArtistPage）
- 各来源登录 IPC 实现
- FlowingMenu 组件（暂保留，如后续不用再删）

---

## 验收标准

1. macOS 原生 traffic lights 可见，关闭/缩小/最大化功能正常
2. TopBar 可拖拽移动窗口，交互元素不触发拖拽
3. 探索 / 我的库 Tab 切换正常，active 状态高亮
4. 后退按钮在有历史时可点，无历史时 disabled
5. 搜索框功能与原 SearchModule 一致
6. 头像下拉菜单：来源切换、账号设置（含各来源登录/退出）、设置入口均可用
7. 全屏模式下布局正常
8. 删除的旧文件无残留引用
