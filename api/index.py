# -*- coding: utf-8 -*-
"""
Gooh旅记 · 任意城市查询 —— Vercel Python Serverless 函数
============================================================

路由：GET /api?name=<城市名>[&date=<YYYY-MM-DD>]
  （函数位于 api/index.py，Vercel 将其映射到 /api 路径）

职责（P0 打通链路）：
  1. OpenTripMap  ：把城市名解析成坐标，再取周边景点（POI）
  2. OpenWeatherMap：取该城市实时天气 + UTC 时区偏移（保证双时钟正确）
  3. 无 key / 查询失败：返回 {ok:false, ...}，前端据此回退本地演示数据（双模式）

2026-08-19 修复（天气 404）：
  - OpenWeatherMap 端点 3.0 优先、2.5 兜底：2025 年后新注册的 key 只能用 3.0
    端点，老 2.5 端点对新 key 返回 404 Not Found。
  - 天气优先按坐标查询（坐标来自 OpenTripMap geocode → OpenWeather geocoding），
    彻底绕开「中文城市名查不到」导致的 404。

部署：Vercel 自动识别 api/ 目录，无第三方依赖（纯标准库）。
环境变量（Vercel Settings → Environment Variables）：
  OPEN_TRIP_MAP_KEY     https://opentripmap.io   （免费 1000 次/天）
  OPEN_WEATHER_MAP_KEY  https://openweathermap.org（免费 1000 次/天）
  GEMINI_API_KEY        https://aistudio.google.com（P1 兜底用，P0 可留空）
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

TIMEOUT = 8
OWM_VERSIONS = ('3.0', '2.5')  # 新 key 只能 3.0，老 key 仍可用 2.5，故 3.0 优先


def _key(name):
    return os.environ.get(name, '').strip()


def _http_get(url, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers={'User-Agent': 'gooh-lvji-demo/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _cors():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    }


# ---------------- OpenTripMap ----------------
def _geocode(name, key):
    """城市名 → {lon, lat, name}（取第一个命中）"""
    url = 'https://api.opentripmap.com/0.1/en/places/geocode?' + urllib.parse.urlencode(
        {'name': name, 'apikey': key})
    data = _http_get(url)
    hits = data.get('hits') or []
    if not hits:
        return None
    hit = hits[0]
    return {'lon': float(hit['lon']), 'lat': float(hit['lat']), 'name': hit.get('name', name)}


def _places_around(lon, lat, key, radius=5000, limit=12):
    """坐标 → 周边景点列表（去重、带名称与评分）"""
    url = ('https://api.opentripmap.com/0.1/en/places/radius?' +
           urllib.parse.urlencode({'radius': radius, 'lon': lon, 'lat': lat,
                                   'kinds': 'interesting_places,other',
                                   'limit': limit, 'apikey': key}))
    data = _http_get(url)
    seen = set()
    out = []
    for f in data.get('features') or []:
        p = f.get('properties') or {}
        nm = (p.get('name') or '').strip()
        if not nm or nm.lower() in seen:
            continue
        seen.add(nm.lower())
        extract = (p.get('wikipedia_extracts') or {}).get('text') or ''
        out.append({
            'name': nm,
            'rate': p.get('rate') or 0,
            'kind': (p.get('kinds') or '').split(',')[0],
            'desc': extract[:80],
        })
        if len(out) >= limit:
            break
    return out


# ---------------- OpenWeatherMap ----------------
def _owm_geocode(name, key):
    """城市名 → 坐标（OpenWeather 自身 geocoding，独立于 OpenTripMap）"""
    url = 'https://api.openweathermap.org/geo/1.0/direct?' + urllib.parse.urlencode(
        {'q': name, 'limit': 1, 'appid': key})
    try:
        data = _http_get(url)
        if data:
            return {'lat': data[0]['lat'], 'lon': data[0]['lon']}
    except Exception:  # noqa: BLE001
        pass
    return None


def _weather(name, coords, key):
    """实时天气 + UTC 时区偏移（秒）。

    查法优先级：坐标（来自 OpenTripMap geocode）
              → OpenWeather 自身 geocoding
              → 城市名 q（仅兜底，中文名可能查不到）。
    端点：3.0 优先、2.5 兜底。
    """
    if coords:
        params = {'lat': coords['lat'], 'lon': coords['lon']}
    else:
        g = _owm_geocode(name, key)
        params = {'lat': g['lat'], 'lon': g['lon']} if g else {'q': name}

    errors = []
    for ver in OWM_VERSIONS:
        url = ('https://api.openweathermap.org/data/' + ver + '/weather?' +
               urllib.parse.urlencode(dict(params, appid=key, units='metric', lang='zh_cn')))
        try:
            data = _http_get(url)
            if data.get('cod') != 200:
                errors.append(ver + ': ' + str(data.get('cod')) + ' ' + str(data.get('message', '')))
                continue
            return {
                'temp': round(data['main']['temp']),
                'desc': (data['weather'][0].get('description') or ''),
                'tz_offset': data.get('timezone', 0),   # 秒；北京 UTC+8 = 28800
                'country': (data.get('sys') or {}).get('country', ''),
            }
        except urllib.error.HTTPError as e:
            errors.append(ver + ': HTTP ' + str(e.code))
        except Exception as e:  # noqa: BLE001
            errors.append(ver + ': ' + str(e))
    raise Exception('; '.join(errors) or '天气查询失败')


# ---------------- 入口 ----------------
def _run(params):
    name = (params.get('name') or [''])[0].strip()
    if not name:
        return {'ok': False, 'error': 'missing_name', 'message': '缺少城市参数 name'}

    otm = _key('OPEN_TRIP_MAP_KEY')
    owm = _key('OPEN_WEATHER_MAP_KEY')
    if not otm and not owm:
        return {'ok': False, 'error': 'no_keys',
                'message': '后端未配置 API key，已回退本地演示数据'}

    result = {'ok': True, 'city': name}
    geo = None

    # 坐标（供天气 + 景点共用）
    if otm:
        try:
            geo = _geocode(name, otm)
            if geo:
                result['coords'] = {'lon': geo['lon'], 'lat': geo['lat']}
            else:
                result['geo_note'] = 'OpenTripMap 未找到该城市，可尝试英文名'
        except Exception as e:  # noqa: BLE001
            result['geo_error'] = str(e)

    # 天气 + 时区（优先坐标，保证任意城市名都能查准；3.0→2.5 端点兜底）
    if owm:
        try:
            result['weather'] = _weather(name, result.get('coords'), owm)
        except Exception as e:  # noqa: BLE001
            result['weather'] = {'error': str(e)}

    # 景点
    if otm:
        try:
            if geo:
                result['places'] = _places_around(geo['lon'], geo['lat'], otm)
            else:
                result['places'] = []
        except Exception as e:  # noqa: BLE001
            result['places'] = []
            result['places_error'] = str(e)

    result['has_places'] = bool(result.get('places'))
    return result


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in _cors().items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        try:
            body = _run(params)
        except Exception as e:  # noqa: BLE001
            body = {'ok': False, 'error': 'server_error', 'message': str(e)}
        payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        for k, v in _cors().items():
            self.send_header(k, v)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # 静默访问日志，避免噪声
        pass
