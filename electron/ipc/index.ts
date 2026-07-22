import { registerWindowIpc } from './window'
import { registerLyricsIpc } from './lyrics'
import { registerWallpaperIpc } from './wallpaper'
import { registerMiniPlayerIpc } from './miniplayer'
import { registerLoginIpc } from './login'
import { registerMiscIpc } from './misc'

export function registerIpc(): void {
  registerWindowIpc()
  registerLyricsIpc()
  registerWallpaperIpc()
  registerMiniPlayerIpc()
  registerLoginIpc()
  registerMiscIpc()
}
