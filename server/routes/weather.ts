import type { RouteHandler, ServerContext } from '../types'
import { sendJson } from '../lib/http'
import { buildWeatherRadio, fetchIpWeatherLocation } from '../lib/weather'

export const weatherRoutes: RouteHandler = async (req, res, url, ctx: ServerContext) => {
  const pn = url.pathname

  // ---------- 天气电台 ----------
  if (pn === '/api/weather/radio') {
    try {
      const data = await buildWeatherRadio(
        {
          city: url.searchParams.get('city') || url.searchParams.get('q') || '',
          lat: url.searchParams.get('lat'),
          lon: url.searchParams.get('lon'),
          timezone: url.searchParams.get('timezone') || '',
        },
        ctx.port
      )
      sendJson(res, data)
    } catch (err) {
      console.error('[WeatherRadio]', err)
      sendJson(
        res,
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          weather: null,
          radio: { title: '天气电台', subtitle: '天气暂时没有回来，可以先听今日推荐。', seedQueries: [], songs: [] },
        },
        500
      )
    }
    return true
  }

  // ---------- IP 定位 ----------
  if (pn === '/api/weather/ip-location') {
    try {
      sendJson(res, { ok: true, location: await fetchIpWeatherLocation() })
    } catch (err) {
      console.error('[WeatherIpLocation]', err)
      sendJson(res, { ok: false, error: err instanceof Error ? err.message : String(err), location: null }, 500)
    }
    return true
  }

  return false
}
