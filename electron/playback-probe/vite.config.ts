import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

// 独立输出目录；默认构建和安装包不引用该原型入口。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: resolve('out-probe/main'), rollupOptions: { input: { index: resolve('electron/playback-probe/main.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: resolve('out-probe/preload'), rollupOptions: {
      input: { index: resolve('electron/playback-probe/preload.ts') }, output: { format: 'cjs', entryFileNames: '[name].cjs' },
    } },
  },
  renderer: {
    root: resolve('src/playback-probe'),
    server: { host: '127.0.0.1' },
    build: { outDir: resolve('out-probe/renderer'), rollupOptions: { input: {
      control: resolve('src/playback-probe/control.html'), host: resolve('src/playback-probe/host.html'),
    } } },
  },
})
