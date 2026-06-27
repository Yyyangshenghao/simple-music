// ====================================================================
//  更新相关路由（自参考项目 server.js dispatcher 第 3243 行起移植）
//  - /api/app/version
//  - /api/update/latest
//  - /api/update/download (+ /status)
//  - /api/update/patch    (+ /status)  ← 补丁热更新在新架构暂不支持
// ====================================================================
import type { RouteHandler } from '../types'
import { sendJson } from '../lib/http'
import {
  APP_INFO,
  UPDATE_CONFIG,
  fetchLatestUpdateInfo,
  localUpdateFallback,
  startUpdateDownloadJob,
  startUpdatePatchJob,
  publicUpdateJob,
  updateDownloadJobs,
} from '../lib/update'

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  return fallback
}

export const updateRoutes: RouteHandler = async (req, res, url, ctx) => {
  const pn = url.pathname

  // ---------- 应用版本 + 更新配置 ----------
  if (pn === '/api/app/version') {
    sendJson(res, {
      name: APP_INFO.name,
      productName: APP_INFO.productName,
      version: APP_INFO.version,
      update: {
        provider: UPDATE_CONFIG.provider,
        configured: UPDATE_CONFIG.configured,
        owner: UPDATE_CONFIG.owner,
        repo: UPDATE_CONFIG.repo,
        preview: UPDATE_CONFIG.preview,
        manifestOverride: !!UPDATE_CONFIG.manifest,
      },
    })
    return true
  }

  // ---------- 检查最新版本 ----------
  if (pn === '/api/update/latest') {
    try {
      sendJson(res, await fetchLatestUpdateInfo())
    } catch (err) {
      sendJson(res, {
        ...localUpdateFallback(errMessage(err, 'Update check failed'), { configured: UPDATE_CONFIG.configured }),
        error: errMessage(err, 'Update check failed'),
      })
    }
    return true
  }

  // ---------- 启动安装包下载 ----------
  if (pn === '/api/update/download') {
    try {
      const info = await fetchLatestUpdateInfo()
      const job = startUpdateDownloadJob(info, ctx)
      sendJson(res, job, job.ok ? 200 : 400)
    } catch (err) {
      console.error('[UpdateDownload]', err)
      sendJson(res, { ok: false, error: errMessage(err, 'UPDATE_DOWNLOAD_START_FAILED') }, 500)
    }
    return true
  }

  // ---------- 下载任务状态 ----------
  if (pn === '/api/update/download/status') {
    const id = url.searchParams.get('id') || ''
    const job = id
      ? updateDownloadJobs.get(id)
      : Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
    sendJson(res, publicUpdateJob(job), job ? 200 : 404)
    return true
  }

  // ---------- 启动快速补丁（新架构暂不支持，详见 lib/update.ts） ----------
  if (pn === '/api/update/patch') {
    try {
      const info = await fetchLatestUpdateInfo()
      const job = startUpdatePatchJob(info, ctx)
      sendJson(res, job, job.ok ? 200 : 400)
    } catch (err) {
      console.error('[UpdatePatch]', err)
      sendJson(res, { ok: false, error: errMessage(err, 'UPDATE_PATCH_START_FAILED') }, 500)
    }
    return true
  }

  // ---------- 补丁任务状态 ----------
  if (pn === '/api/update/patch/status') {
    const id = url.searchParams.get('id') || ''
    const job = id
      ? updateDownloadJobs.get(id)
      : Array.from(updateDownloadJobs.values())
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .find((item) => item.mode === 'patch')
    sendJson(res, publicUpdateJob(job), job ? 200 : 404)
    return true
  }

  return false
}
