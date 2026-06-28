import { registerWindowIpc } from './window'
import { registerLyricsIpc } from './lyrics'
import { registerWallpaperIpc } from './wallpaper'
import { registerLoginIpc } from './login'
import { registerMiscIpc } from './misc'

export function registerIpc(): void {
  registerWindowIpc()
  registerLyricsIpc()
  registerWallpaperIpc()
  registerLoginIpc()
  registerMiscIpc()
}
