import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve('electron/main.ts') } } } },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/preload/index.ts'),
          overlay: resolve('electron/preload/overlay.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    resolve: { alias: { '@renderer': resolve('src') } },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('index.html'),
          'desktop-lyrics': resolve('overlays/desktop-lyrics/desktop-lyrics.html'),
          wallpaper: resolve('overlays/wallpaper/wallpaper.html')
        }
      }
    }
  }
})
