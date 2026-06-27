// 天气相关辅助：Open-Meteo 预报 / 地理编码、IP 定位、天气电台构建。
// 忠实移植自参考项目 server.js（buildWeatherRadio / fetchIpWeatherLocation 及其依赖链）。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_IP_LOCATION_URL = 'http://ip-api.com/json/'

interface ResolvedLocation {
  name: string
  country: string
  admin1?: string
  latitude: number | null
  longitude: number | null
  timezone: string
  query?: string
  fallback?: boolean
}

const WEATHER_DEFAULT_LOCATION: ResolvedLocation = {
  name: '上海',
  country: 'China',
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'Asia/Shanghai',
}

// ---------- 类型 ----------
export interface WeatherMood {
  key: string
  title: string
  tagline: string
  energy: number
  warmth: number
  focus: number
  melancholy: number
  keywords: string[]
}

export interface WeatherLocation {
  name: string
  country: string
  admin1: string
  latitude: number | null
  longitude: number | null
  timezone: string
  fallback: boolean
}

export interface Weather {
  provider: string
  location: WeatherLocation
  label: string
  weatherCode: number | null
  temperature: number | null
  apparentTemperature: number | null
  humidity: number | null
  precipitation: number | null
  cloudCover: number | null
  windSpeed: number | null
  windGusts: number | null
  isDay: number | null
  time: string
  updatedAt: number
  error?: string
  mood: WeatherMood
}

export interface IpWeatherLocation {
  provider: string
  city: string
  region: string
  country: string
  latitude: number
  longitude: number
  timezone: string
  ip: string
}

export interface WeatherParams {
  city?: string
  q?: string
  location?: string
  name?: string
  lat?: string | number | null
  lon?: string | number | null
  timezone?: string
}

export interface WeatherSong {
  id?: string | number
  name?: string
  artist?: string
  album?: string
  cover?: string
  duration?: number
  weatherSource?: string
  [key: string]: unknown
}

export interface WeatherRadio {
  title: string
  subtitle: string
  seedQueries: string[]
  songs: WeatherSong[]
  updatedAt: number
}

export interface WeatherRadioResult {
  ok: boolean
  weather: Weather
  radio: WeatherRadio
}

// ---------- 通用工具 ----------
function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

async function requestJson(targetUrl: string): Promise<unknown> {
  const res = await fetch(targetUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status) as Error & { statusCode?: number }
    err.statusCode = res.status
    throw err
  }
  return res.json()
}

// ---------- Open-Meteo 天气码映射 ----------
function openMeteoWeatherLabel(code: unknown): string {
  const c = Number(code)
  if (c === 0) return '晴'
  if (c === 1 || c === 2) return '少云'
  if (c === 3) return '阴'
  if (c === 45 || c === 48) return '雾'
  if (c === 51 || c === 53 || c === 55) return '毛毛雨'
  if (c === 56 || c === 57) return '冻雨'
  if (c === 61 || c === 63 || c === 65) return '雨'
  if (c === 66 || c === 67) return '冻雨'
  if (c === 71 || c === 73 || c === 75 || c === 77) return '雪'
  if (c === 80 || c === 81 || c === 82) return '阵雨'
  if (c === 85 || c === 86) return '阵雪'
  if (c === 95 || c === 96 || c === 99) return '雷雨'
  return '天气'
}

interface WeatherMoodInput {
  weatherCode?: number | null
  temperature?: number | null
  apparentTemperature?: number | null
  precipitation?: number | null
  humidity?: number | null
  windSpeed?: number | null
  isDay?: number | null
}

function buildWeatherMood(weather: WeatherMoodInput, date?: Date): WeatherMood {
  const now = date || new Date()
  const hour = now.getHours()
  const code = Number(weather && weather.weatherCode)
  const temp = Number(weather && weather.temperature)
  const apparent = Number(weather && weather.apparentTemperature)
  const rain = Number(weather && weather.precipitation) || 0
  const humidity = Number(weather && weather.humidity) || 0
  const wind = Number(weather && weather.windSpeed) || 0
  const isNight = (weather && weather.isDay === 0) || hour < 6 || hour >= 20
  const isMorning = hour >= 5 && hour < 11
  const isDusk = hour >= 17 && hour < 20
  const isRain = rain > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)
  const isSnow = [71, 73, 75, 77, 85, 86].includes(code)
  const isCloud = [2, 3, 45, 48].includes(code)
  const isStorm = [95, 96, 99].includes(code)
  const feels = Number.isFinite(apparent) ? apparent : temp

  let mood: WeatherMood = {
    key: 'clear',
    title: '晴朗电台',
    tagline: '让节奏亮一点，像窗边的光',
    energy: 0.62,
    warmth: 0.58,
    focus: 0.48,
    melancholy: 0.24,
    keywords: ['轻快 华语', 'city pop', 'indie pop', 'chill pop', '阳光 歌单'],
  }
  if (isStorm) {
    mood = {
      key: 'storm',
      title: '雷雨电台',
      tagline: '低频更厚，适合把世界关小一点',
      energy: 0.46,
      warmth: 0.34,
      focus: 0.66,
      melancholy: 0.62,
      keywords: ['暗色 R&B', 'trip hop', '夜晚 电子', '氛围 摇滚', '雨夜 歌单'],
    }
  } else if (isRain) {
    mood = {
      key: 'rain',
      title: '雨天电台',
      tagline: '留一点潮湿的空间给旋律',
      energy: 0.38,
      warmth: 0.42,
      focus: 0.64,
      melancholy: 0.66,
      keywords: ['雨天 R&B', 'lofi rainy', '华语 慢歌', 'dream pop', '雨夜 歌单'],
    }
  } else if (isSnow || feels <= 3) {
    mood = {
      key: 'snow',
      title: '冷空气电台',
      tagline: '干净、慢速、带一点冬天的颗粒感',
      energy: 0.34,
      warmth: 0.28,
      focus: 0.72,
      melancholy: 0.54,
      keywords: ['冬天 民谣', 'ambient piano', '日系 冬天', 'indie folk', '安静 歌单'],
    }
  } else if (feels >= 31 || humidity >= 78) {
    mood = {
      key: 'humid',
      title: '闷热电台',
      tagline: '降低密度，留出一点呼吸',
      energy: 0.48,
      warmth: 0.76,
      focus: 0.46,
      melancholy: 0.3,
      keywords: ['夏日 chill', 'bossa nova', 'city pop 夏天', '轻电子', '海边 歌单'],
    }
  } else if (isCloud) {
    mood = {
      key: 'cloudy',
      title: '阴天电台',
      tagline: '不急着明亮，先让声音变软',
      energy: 0.4,
      warmth: 0.46,
      focus: 0.58,
      melancholy: 0.52,
      keywords: ['阴天 华语', 'indie rock mellow', 'neo soul', 'chillhop', '独立 民谣'],
    }
  }

  if (isNight) {
    mood.key += '-night'
    mood.title = mood.key.startsWith('clear') ? '夜色电台' : mood.title.replace('电台', '夜听')
    mood.tagline = '音量放低一点，让夜色参与编曲'
    mood.energy = Math.min(mood.energy, 0.42)
    mood.focus = Math.max(mood.focus, 0.68)
    mood.melancholy = Math.max(mood.melancholy, 0.52)
    mood.keywords = ['夜晚 R&B', 'late night jazz', 'ambient', 'lofi sleep', '夜跑 歌单'].concat(mood.keywords.slice(0, 3))
  } else if (isMorning) {
    mood.title = mood.key.startsWith('rain') ? '雨晨电台' : '早晨电台'
    mood.energy = Math.max(mood.energy, 0.52)
    mood.keywords = ['早晨 通勤', 'morning acoustic', '清晨 indie', '轻快 华语'].concat(mood.keywords.slice(0, 3))
  } else if (isDusk) {
    mood.title = mood.key.startsWith('rain') ? '黄昏雨声' : '黄昏电台'
    mood.melancholy = Math.max(mood.melancholy, 0.48)
    mood.keywords = ['黄昏 city pop', '日落 歌单', '落日飞车', 'soul pop'].concat(mood.keywords.slice(0, 3))
  }

  if (wind >= 28) {
    mood.energy = Math.max(mood.energy, 0.56)
    mood.keywords = ['公路 摇滚', 'windy day playlist'].concat(mood.keywords.slice(0, 4))
  }
  mood.keywords = Array.from(new Set(mood.keywords)).slice(0, 7)
  return mood
}

// ---------- Open-Meteo 地理编码与预报 ----------
interface GeocodeResult {
  name?: string
  country?: string
  admin1?: string
  latitude: number
  longitude: number
  timezone?: string
}

async function resolveOpenMeteoLocation(query: unknown): Promise<ResolvedLocation> {
  const raw = String(query || '').trim()
  if (!raw) return WEATHER_DEFAULT_LOCATION
  const u = new URL(OPEN_METEO_GEOCODE_URL)
  u.searchParams.set('name', raw)
  u.searchParams.set('count', '1')
  u.searchParams.set('language', 'zh')
  u.searchParams.set('format', 'json')
  const body = toRecord(await requestJson(u.toString()))
  const results = body.results
  const first = Array.isArray(results) ? (results[0] as GeocodeResult | undefined) : undefined
  if (!first) return { ...WEATHER_DEFAULT_LOCATION, query: raw, fallback: true }
  return {
    name: first.name || raw,
    country: first.country || '',
    admin1: first.admin1 || '',
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'auto',
  }
}

interface OpenMeteoCurrent {
  temperature_2m?: number
  relative_humidity_2m?: number
  apparent_temperature?: number
  is_day?: number
  precipitation?: number
  rain?: number
  showers?: number
  snowfall?: number
  weather_code?: number
  cloud_cover?: number
  wind_speed_10m?: number
  wind_gusts_10m?: number
  time?: string
}

async function fetchOpenMeteoWeather(params: WeatherParams): Promise<Weather> {
  params = params || {}
  let location: ResolvedLocation
  const lat = clampNumber(params.lat, -90, 90, NaN)
  const lon = clampNumber(params.lon, -180, 180, NaN)
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    location = {
      name: String(params.city || params.name || '当前位置').trim() || '当前位置',
      country: '',
      latitude: lat,
      longitude: lon,
      timezone: params.timezone || 'auto',
    }
  } else {
    location = await resolveOpenMeteoLocation(params.city || params.q || params.location)
  }
  const u = new URL(OPEN_METEO_FORECAST_URL)
  u.searchParams.set('latitude', String(location.latitude))
  u.searchParams.set('longitude', String(location.longitude))
  u.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m'
  )
  u.searchParams.set('hourly', 'precipitation_probability,weather_code,temperature_2m')
  u.searchParams.set('forecast_days', '1')
  u.searchParams.set('timezone', location.timezone || 'auto')
  const body = toRecord(await requestJson(u.toString()))
  const cur = (body.current as OpenMeteoCurrent | undefined) || {}
  const weather: Weather = {
    provider: 'open-meteo',
    location: {
      name: location.name,
      country: location.country || '',
      admin1: location.admin1 || '',
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: (body.timezone as string | undefined) || location.timezone || '',
      fallback: !!location.fallback,
    },
    label: openMeteoWeatherLabel(cur.weather_code),
    weatherCode: Number(cur.weather_code),
    temperature: Number(cur.temperature_2m),
    apparentTemperature: Number(cur.apparent_temperature),
    humidity: Number(cur.relative_humidity_2m),
    precipitation: Number(cur.precipitation || cur.rain || cur.showers || cur.snowfall || 0),
    cloudCover: Number(cur.cloud_cover),
    windSpeed: Number(cur.wind_speed_10m),
    windGusts: Number(cur.wind_gusts_10m),
    isDay: Number(cur.is_day),
    time: cur.time || '',
    updatedAt: Date.now(),
    mood: { key: '', title: '', tagline: '', energy: 0, warmth: 0, focus: 0, melancholy: 0, keywords: [] },
  }
  weather.mood = buildWeatherMood(weather)
  return weather
}

// ---------- IP 定位 ----------
interface IpApiResponse {
  status?: string
  message?: string
  country?: string
  regionName?: string
  city?: string
  lat?: number
  lon?: number
  timezone?: string
  query?: string
}

export async function fetchIpWeatherLocation(): Promise<IpWeatherLocation> {
  const u = new URL(WEATHER_IP_LOCATION_URL)
  u.searchParams.set('fields', 'status,message,country,regionName,city,lat,lon,timezone,query')
  u.searchParams.set('lang', 'zh-CN')
  const body = (await requestJson(u.toString())) as IpApiResponse | null
  if (!body || body.status !== 'success' || !Number.isFinite(Number(body.lat)) || !Number.isFinite(Number(body.lon))) {
    const err = new Error((body && body.message) || 'IP_LOCATION_FAILED') as Error & { body?: unknown }
    err.body = body
    throw err
  }
  return {
    provider: 'ip-api',
    city: body.city || WEATHER_DEFAULT_LOCATION.name,
    region: body.regionName || '',
    country: body.country || '',
    latitude: Number(body.lat),
    longitude: Number(body.lon),
    timezone: body.timezone || 'auto',
    ip: body.query || '',
  }
}

// ---------- 电台 seed 与兜底 ----------
function weatherRadioSeedQueries(mood: WeatherMood | undefined): string[] {
  const key = String((mood && mood.key) || '')
  if (key.includes('rain') || key.includes('storm'))
    return ['陈奕迅 阴天快乐', '周杰伦 雨下一整晚', '孙燕姿 遇见', '林宥嘉 说谎', '毛不易 消愁']
  if (key.includes('snow') || key.includes('cloudy'))
    return ['陈奕迅 好久不见', '莫文蔚 阴天', '李健 贝加尔湖畔', '朴树 平凡之路', '蔡健雅 达尔文']
  if (key.includes('humid'))
    return ['落日飞车 My Jinji', '告五人 爱人错过', '夏日入侵企画 想去海边', '陈绮贞 旅行的意义', '王若琳 Lost in Paradise']
  if (key.includes('night'))
    return ['方大同 特别的人', '陶喆 爱很简单', 'Frank Ocean Pink + White', '林忆莲 夜太黑', "Norah Jones Don't Know Why"]
  return ['孙燕姿 天黑黑', '周杰伦 晴天', '五月天 温柔', '陈奕迅 稳稳的幸福', '王菲']
}

function fallbackWeatherForRadio(params: WeatherParams, err?: Error): Weather {
  params = params || {}
  const name =
    String(params.city || params.q || params.location || WEATHER_DEFAULT_LOCATION.name).trim() ||
    WEATHER_DEFAULT_LOCATION.name
  return {
    provider: 'open-meteo',
    location: {
      name,
      country: '',
      admin1: '',
      latitude: null,
      longitude: null,
      timezone: params.timezone || WEATHER_DEFAULT_LOCATION.timezone,
      fallback: true,
    },
    label: '天气暂不可用',
    weatherCode: null,
    temperature: null,
    apparentTemperature: null,
    humidity: null,
    precipitation: null,
    cloudCover: null,
    windSpeed: null,
    windGusts: null,
    isDay: null,
    time: '',
    updatedAt: Date.now(),
    error: (err && err.message) || '',
    mood: {
      key: 'fallback',
      title: '临时电台',
      tagline: '天气暂时没有回来，先放一组稳妥的歌',
      energy: 0.54,
      warmth: 0.55,
      focus: 0.55,
      melancholy: 0.35,
      keywords: ['华语 流行', 'indie pop', 'city pop', '轻快 歌单', 'chill pop'],
    },
  }
}

// ---------- 歌曲排序 / 去重 / 多样化 ----------
function uniqueSongsByKey(songs: WeatherSong[]): WeatherSong[] {
  const seen = new Set<string>()
  const out: WeatherSong[] = []
  ;(songs || []).forEach((song) => {
    const key = String((song && (song.id || song.name + '|' + song.artist)) || '').trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(song)
  })
  return out
}

function isLowSignalWeatherSong(song: WeatherSong): boolean {
  const text = String([song && song.name, song && song.artist, song && song.album].filter(Boolean).join(' ')).toLowerCase()
  if (!text) return true
  if (/(^|[\s\-_/（(])ai(?:\s*(歌|歌曲|音乐|cover|翻唱|生成|作曲|演唱|女声|男声)|$|[\s\-_/）)])/i.test(text)) return true
  if (/suno|udio|人工智能|生成歌曲|ai歌曲|虚拟歌手|测试音频|demo|beat\s*maker/i.test(text)) return true
  if (/翻自|翻唱|cover|remix|伴奏|纯音乐|钢琴|dj|live\s*版|live版|唯美钢琴|karaoke|instrumental/i.test(text)) return true
  if (/白噪音|雨声|睡眠|助眠|冥想|疗愈频率|环境音|自然声音|asmr/i.test(text)) return true
  if (/[（(](r&b|lofi|jazz|dj|edm|trap|remix|伴奏|纯音乐|钢琴|电子|治愈|古风|女声|男声|英文|中文版|抖音|ai)[）)]/i.test(text))
    return true
  if (/^(纯音乐|轻音乐|治愈系|放松|睡眠|雨天|阴天|夜晚|夏日|海边)$/i.test(String(song.name || '').trim())) return true
  return false
}

function scoreWeatherSong(song: WeatherSong, mood: WeatherMood | undefined): number {
  const text = String(((song && song.name) || '') + ' ' + ((song && song.artist) || '') + ' ' + ((song && song.album) || '')).toLowerCase()
  let score = 0
  if (song && song.cover) score += 4
  if (song && song.duration) score += 2
  if (song && song.weatherSource === 'daily') score += 6
  if (song && song.weatherSource === 'private') score += 4
  if (/周杰伦|陈奕迅|孙燕姿|五月天|王菲|陶喆|方大同|林宥嘉|蔡健雅|莫文蔚|李健|毛不易|告五人|落日飞车|陈绮贞|朴树/.test(text))
    score += 10
  const key = String((mood && mood.key) || '')
  if (key.includes('rain') && /雨|阴|夜|慢|r&b|soul|陈奕迅|林宥嘉|孙燕姿/.test(text)) score += 5
  if (key.includes('humid') && /夏|海|city|pop|落日|告五人|方大同|陶喆/.test(text)) score += 5
  if (key.includes('night') && /夜|moon|jazz|soul|r&b|方大同|陶喆|王菲/.test(text)) score += 5
  if (key.includes('cloudy') && /阴|民谣|indie|陈绮贞|朴树|李健/.test(text)) score += 5
  return score
}

function weatherArtistKey(song: WeatherSong): string {
  const raw = String((song && song.artist) || (song && song.name) || '').split(/\s*\/\s*|、|,|&/)[0] || ''
  return raw.trim().toLowerCase() || 'unknown'
}

function weatherTitleKey(song: WeatherSong): string {
  return String((song && song.name) || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s._\-·'’"“”「」《》:：/\\|]+/g, '')
    .trim()
}

function uniqueWeatherTitles(sorted: WeatherSong[]): WeatherSong[] {
  const seen = new Set<string>()
  const out: WeatherSong[] = []
  ;(sorted || []).forEach((song) => {
    const key = weatherTitleKey(song)
    if (key && seen.has(key)) return
    if (key) seen.add(key)
    out.push(song)
  })
  return out
}

function diversifyWeatherSongs(sorted: WeatherSong[], artistLimit: number): WeatherSong[] {
  const primary: WeatherSong[] = []
  const deferred: WeatherSong[] = []
  const counts = new Map<string, number>()
  ;(sorted || []).forEach((song) => {
    const key = weatherArtistKey(song)
    const count = counts.get(key) || 0
    if (count < artistLimit) {
      primary.push(song)
      counts.set(key, count + 1)
    } else {
      deferred.push(song)
    }
  })
  return primary.length >= 8 ? primary : primary.concat(deferred.slice(0, 8 - primary.length))
}

function orderWeatherSongs(songs: WeatherSong[], mood: WeatherMood | undefined): WeatherSong[] {
  const sorted = uniqueSongsByKey(songs)
    .filter((song) => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .sort((a, b) => scoreWeatherSong(b, mood) - scoreWeatherSong(a, mood))
  return diversifyWeatherSongs(uniqueWeatherTitles(sorted), 2)
}

// ---------- 取歌：解耦地调用本地 /api/search ----------
async function searchSongs(port: number, keywords: string, limit: number): Promise<WeatherSong[]> {
  const u = new URL(`http://127.0.0.1:${port}/api/search`)
  u.searchParams.set('keywords', keywords)
  u.searchParams.set('limit', String(limit))
  const res = await fetch(u, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) return []
  const body = toRecord(await res.json())
  const songs = body.songs
  return Array.isArray(songs) ? (songs as WeatherSong[]) : []
}

// ---------- 天气电台 ----------
export async function buildWeatherRadio(params: WeatherParams, port: number): Promise<WeatherRadioResult> {
  let weather: Weather
  try {
    weather = await fetchOpenMeteoWeather(params)
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    console.warn('[WeatherRadio] weather provider failed, using fallback radio:', err.message)
    weather = fallbackWeatherForRadio(params, err)
  }
  const queries = weatherRadioSeedQueries(weather.mood)
  let songs: WeatherSong[] = []
  const settled = await Promise.allSettled(queries.slice(0, 4).map((q) => searchSongs(port, q, 6)))
  settled.forEach((result) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value)
  })
  if (songs.length < 10 && weather.mood && Array.isArray(weather.mood.keywords)) {
    const more = await Promise.allSettled(weather.mood.keywords.slice(0, 2).map((q) => searchSongs(port, q, 6)))
    more.forEach((result) => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value)
    })
  }
  songs = orderWeatherSongs(songs, weather.mood)
  return {
    ok: true,
    weather,
    radio: {
      title: weather.mood.title,
      subtitle: weather.mood.tagline,
      seedQueries: queries.slice(0, 4),
      songs: songs.slice(0, 18),
      updatedAt: Date.now(),
    },
  }
}
