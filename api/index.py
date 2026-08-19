# -*- coding: utf-8 -*-
"""
Gooh旅记 · 任意城市查询 —— Vercel Python Serverless 函数
============================================================

路由：GET /api?name=<城市名>[&date=<YYYY-MM-DD>]

职责：
  1. OpenWeatherMap：城市 → 实时天气 + UTC 时区偏移（保证双时钟正确）
  2. Gemini（Google AI Studio）：生成该城市景点列表（覆盖全球任意城市，免费）
  3. 无 key / 失败：返回 {ok:false,...} 或空景点，前端回退（天气+时区仍可用）

2026-08-19 更新：不再依赖 OpenTripMap（其服务器常返回 500、不稳定），
  景点改由 Gemini 生成；天气与景点用 ThreadPoolExecutor 并行，收敛函数执行时长。

环境变量（Vercel Settings → Environment Variables）：
  OPEN_WEATHER_MAP_KEY  https://openweathermap.org   （免费 1000 次/天）
  GEMINI_API_KEY        https://aistudio.google.com/apikey（免费 1500 次/天）
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler

TIMEOUT = 8
OWM_VERSIONS = ('3.0', '2.5')  # 新 key 只能 3.0，老 key 仍可用 2.5，故 3.0 优先
# 按优先级尝试的 Gemini 模型（2026-08 起 2.5-flash 为稳定免费模型，2.0/1.5 已退役）
GEMINI_MODELS = ('gemini-2.5-flash', 'gemini-2.5-flash-lite')


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


# ---------------- OpenWeatherMap ----------------
def _owm_geocode(name, key):
    """城市名 → 坐标（OpenWeather 自身 geocoding，独立于第三方地图）"""
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
    """实时天气 + UTC 时区偏移（秒）。坐标优先，端点 3.0→2.5 兜底。"""
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


# ---------------- Gemini（生成景点） ----------------
def _gemini_json(prompt, key, max_tokens=1024, timeout=12):
    """调用 Gemini 生成内容并返回原始文本（按优先级尝试多个模型，首个成功即返回）。"""
    payload = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'temperature': 0.7, 'maxOutputTokens': max_tokens},
    }
    body = json.dumps(payload).encode('utf-8')
    errors = []
    for model in GEMINI_MODELS:
        url = ('https://generativelanguage.googleapis.com/v1beta/models/' +
               model + ':generateContent')
        req = urllib.request.Request(
            url, data=body,
            headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read().decode('utf-8'))
            parts = data.get('candidates', [{}])[0].get('content', {}).get('parts', [])
            if parts:
                return parts[0].get('text', '')
            errors.append(model + ': 空响应')
        except urllib.error.HTTPError as e:
            errors.append(model + ': HTTP ' + str(e.code))
        except Exception as e:  # noqa: BLE001
            errors.append(model + ': ' + str(e))
    raise Exception('; '.join(errors) or 'Gemini 调用失败')


def _extract_json(text):
    """从模型输出中提取 JSON 数组（容忍 ```json 包裹与前后废话）。"""
    if not text:
        return []
    m = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', text, re.S)
    body = m.group(1) if m else text
    a, b = body.find('['), body.rfind(']')
    if a != -1 and b > a:
        body = body[a:b + 1]
    try:
        arr = json.loads(body)
        return arr if isinstance(arr, list) else []
    except Exception:  # noqa: BLE001
        return []


def _places_by_gemini(city, key):
    """Gemini 生成城市景点列表（任意城市、免费、稳定兜底）。"""
    prompt = (
        '你是一名旅行攻略助手。请为城市「' + city + '」推荐 8 个值得去的景点，'
        '用严格 JSON 数组返回，每个元素 3 个字段：'
        'name 为景点名（中文优先）；kind 为分类（景点/美食/公园/博物馆/购物/夜景，选最贴切的一个）；'
        'one_line 为一句中文推荐理由，不超过 30 字。'
        '只输出 JSON 数组，不要 Markdown，不要多余文字。'
        '示例：[{"name":"浅草寺","kind":"景点","one_line":"东京最古老的寺庙，浅草雷门地标"}]'
    )
    text = _gemini_json(prompt, key)
    places = []
    for it in _extract_json(text):
        nm = (it.get('name') or '').strip()
        if not nm:
            continue
        places.append({
            'name': nm,
            'kind': (it.get('kind') or '景点')[:12],
            'desc': (it.get('one_line') or '').strip()[:80],
            'rate': 0,
        })
    return places


# ---------------- 入口 ----------------
def _run(params):
    name = (params.get('name') or [''])[0].strip()
    if not name:
        return {'ok': False, 'error': 'missing_name', 'message': '缺少城市参数 name'}

    owm = _key('OPEN_WEATHER_MAP_KEY')
    gem = _key('GEMINI_API_KEY')
    if not owm and not gem:
        return {'ok': False, 'error': 'no_keys',
                'message': '后端未配置 API key，已回退本地演示数据'}

    result = {'ok': True, 'city': name}

    # 坐标（展示用，来自 OpenWeather geocoding）
    if owm:
        try:
            g = _owm_geocode(name, owm)
            if g:
                result['coords'] = {'lon': g['lon'], 'lat': g['lat']}
        except Exception:  # noqa: BLE001
            pass

    # 天气 与 景点 并行，收敛函数执行时长（Vercel 免费层有上限）
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_weather = ex.submit(_weather, name, result.get('coords'), owm) if owm else None
        f_places = ex.submit(_places_by_gemini, name, gem) if gem else None

        if f_weather:
            try:
                result['weather'] = f_weather.result()
            except Exception as e:  # noqa: BLE001
                result['weather'] = {'error': str(e)}

        if f_places:
            try:
                result['places'] = f_places.result()
                result['places_source'] = 'gemini'
            except Exception as e:  # noqa: BLE001
                result['places'] = []
                result['places_error'] = str(e)
        else:
            result['places'] = []
            result['geo_note'] = '未配置 GEMINI_API_KEY，无法生成景点（天气/时区仍可用）'

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
