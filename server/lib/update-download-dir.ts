import { join } from 'node:path'

export function updateWorkDir(userDataDir: string): string {
  return process.env.SIMPLEMUSIC_UPDATE_DIR || join(userDataDir, 'updates')
}

export function updateDownloadDir(userDataDir: string): string {
  return process.env.SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR || join(updateWorkDir(userDataDir), 'downloads')
}
