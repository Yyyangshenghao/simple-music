import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('electron/main.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/preload/index.ts'),
          overlay: resolve('electron/preload/overlay.ts')
        },
        // 沙盒化 preload(sandbox:true)在纯 JS 环境运行,不支持 ESM import,
        // 故强制输出 CommonJS(.cjs);electron 依旧走 require('electron')。
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: '.',
    resolve: { alias: { '@renderer': resolve('src') } },
    plugins: [react()],
    // Windows 上 Vite 默认可能只绑 IPv6 [::1],Electron 解析 localhost 走另一族会
    // ERR_CONNECTION_REFUSED。显式绑 127.0.0.1 确保 IPv4 回环可连。
    server: { host: '127.0.0.1' },
    build: {
      rollupOptions: {
        input: {
          index: resolve('index.html'),
          'desktop-lyrics': resolve('overlays/desktop-lyrics/desktop-lyrics.html'),
          wallpaper: resolve('overlays/wallpaper/wallpaper.html'),
          'mini-player': resolve('overlays/mini-player/mini-player.html')
        }
      }
    }
  }
})
