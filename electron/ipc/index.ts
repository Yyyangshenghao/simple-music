import { registerWindowIpc } from './window'
import { registerLyricsIpc } from './lyrics'
import { registerWallpaperIpc } from './wallpaper'
import { registerMiniPlayerIpc } from './miniplayer'
import { registerLoginIpc } from './login'
import { registerMiscIpc } from './misc'
import { registerAppleAudioIpc } from './apple-audio'
import { registerGameModeIpc } from './game-mode'

export function registerIpc(): void {
  registerWindowIpc()
  registerLyricsIpc()
  registerWallpaperIpc()
  registerMiniPlayerIpc()
  registerLoginIpc()
  registerMiscIpc()
  registerAppleAudioIpc()
  registerGameModeIpc()
}
