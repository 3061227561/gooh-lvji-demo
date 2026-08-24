# -*- coding: utf-8 -*-
"""
Gooh旅记 · 任意城市攻略生成器 —— Vercel Python Serverless 函数
================================================================

路由：
  GET  /api?name=<城市>&days=<天数>&budget=<档位>&preferences=<偏好>
       天气/时区/坐标 + 智谱生成完整每日行程（itinerary，与前端 DATA.trip 结构一致）
  POST /api/adjust    {city, instruction, itinerary, budget}
       根据用户实时反馈，重新生成调整后的完整行程

数据源：
  OpenWeatherMap：天气 + UTC 时区（3.0→2.5 端点兜底、坐标优先）
  智谱 GLM-4-Flash：生成完整行程 / 调整行程（OpenAI 兼容端点，国内直连免费）
  Google Gemini：可选兜底（原生端点，多模型）

双模式：无 key / 断网 / API 失败 → 返回 ok:false 或空，前端回退本地东京演示数据。

环境变量（Vercel Settings → Environment Variables）：
  OPEN_WEATHER_MAP_KEY  https://openweathermap.org   （免费 1000 次/天）
  ZHIPU_API_KEY         https://open.bigmodel.cn    （glm-4-flash 免费，推荐）
  GEMINI_API_KEY        https://aistudio.google.com/apikey（可选，兜底）
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler

TIMEOUT = 8
OWM_VERSIONS = ('3.0', '2.5')  # 新 key 只能 3.0，老 key 仍可用 2.5，故 3.0 优先

# 智谱（OpenAI 兼容端点）
ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
ZHIPU_MODEL = 'glm-4-flash'

# Gemini 原生端点，按优先级尝试；若报 model no longer available，按提示换新模型名
GEMINI_MODELS = ('gemini-3.6-flash', 'gemini-3.5-flash-lite')

# 行程相关 tag 白名单（供景点抽取用）
TOURISM_TAGS = ('景点', '美食', '购物', '夜景', '公园', '博物馆', '休憩', '演出', '体验')


def _key(name):
    return os.environ.get(name, '').strip()


def _http_get(url, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers={'User-Agent': 'gooh-lvji-demo/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _cors():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    }


def _mask_key(k):
    if not k:
        return 'not-set'
    return k[:6] + '...(' + str(len(k)) + ' 字符)'


def _ping():
    """诊断端点：确认函数存活 + 环境变量是否配好（只显示 key 前几位）。"""
    import datetime
    return {
        'ok': True,
        'service': 'gooh-api (tencent scf)',
        'time': datetime.datetime.utcnow().isoformat() + 'Z',
        'python': sys.version.split()[0],
        'env': {
            'ZHIPU_API_KEY': _mask_key(_key('ZHIPU_API_KEY')),
            'OPEN_WEATHER_MAP_KEY': _mask_key(_key('OPEN_WEATHER_MAP_KEY')),
        },
    }


def _time_to_min(t):
    try:
        h, m = str(t).split(':')
        return int(h) * 60 + int(m)
    except Exception:  # noqa: BLE001
        return 0


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


# ---------------- 和风天气 QWeather（国内直连，腾讯云场景更稳） ----------------
def _tz_to_sec(off):
    """'+09:00' -> 32400 秒。"""
    try:
        s = str(off).strip()
        sign = -1 if s.startswith('-') else 1
        s = s.lstrip('+-')
        h, m = s.split(':')
        return sign * (int(h) * 3600 + int(m) * 60)
    except Exception:  # noqa: BLE001
        return 0


def _qw_get(url, key, timeout=8):
    """请求和风天气，兼容 X-QW-Api-Key header 与 ?key= 两种认证。"""
    req = urllib.request.Request(
        url, headers={'X-QW-Api-Key': key, 'User-Agent': 'gooh-lvji-demo/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError:
        url2 = url + ('&' if '?' in url else '?') + 'key=' + urllib.parse.quote(key)
        req2 = urllib.request.Request(url2, headers={'User-Agent': 'gooh-lvji-demo/1.0'})
        with urllib.request.urlopen(req2, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))


def _qweather(name, key, host):
    """和风天气：城市定位 + 实时天气（用个人专属 API Host，共享域名 2026 起停用）。"""
    host = host or 'devapi.qweather.com'  # fallback 共享域名（可能 404，配 QWEATHER_HOST 为准）
    url = ('https://' + host + '/geo/v2/city/lookup?' +
           urllib.parse.urlencode({'location': name}))
    data = _qw_get(url, key)
    if data.get('code') != '200':
        raise Exception('和风定位失败(%s): %s' % (data.get('code'), name))
    locs = data.get('location') or []
    if not locs:
        raise Exception('和风未找到城市：' + name)
    loc = locs[0]
    loc_id = loc.get('id') or (str(loc.get('lon')) + ',' + str(loc.get('lat')))
    url2 = ('https://' + host + '/v7/weather/now?' +
            urllib.parse.urlencode({'location': loc_id}))
    w = _qw_get(url2, key)
    if w.get('code') != '200':
        raise Exception('和风天气失败(%s)' % w.get('code'))
    now = w.get('now') or {}
    return {
        'temp': int(now.get('temp') or 0),
        'desc': now.get('text') or '',
        'tz_offset': _tz_to_sec(loc.get('utcOffset') or '+00:00'),
        'country': loc.get('country') or '',
        'coords': {'lon': float(loc.get('lon')), 'lat': float(loc.get('lat'))},
    }


# ---------------- 智谱（OpenAI 兼容端点，国内直连免费） ----------------
def _zhipu_chat(prompt, key, max_tokens=2560, timeout=50):
    """调智谱 GLM-4-Flash 并返回文本内容。

    注：Vercel Hobby 函数时限 10s（当时把 timeout 收紧到 8s）；
    腾讯云 SCF 超时可配 120s，这里放宽到 50s，给智谱生成完整行程留足时间。
    """
    payload = {
        'model': ZHIPU_MODEL,
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.7,
        'max_tokens': max_tokens,
    }
    req = urllib.request.Request(
        ZHIPU_URL, data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode('utf-8'))
    return data['choices'][0]['message']['content']


# ---------------- 通用：prompt 与 JSON 解析 ----------------
def _places_prompt(city):
    return (
        '你是一名旅行攻略助手。请为城市「' + city + '」推荐 8 个值得去的景点，'
        '用严格 JSON 数组返回，每个元素 3 个字段：'
        'name 为景点名（中文优先）；kind 为分类（景点/美食/公园/博物馆/购物/夜景，选最贴切的一个）；'
        'one_line 为一句中文推荐理由，不超过 30 字。'
        '只输出 JSON 数组，不要 Markdown，不要多余文字。'
        '示例：[{"name":"浅草寺","kind":"景点","one_line":"东京最古老的寺庙，浅草雷门地标"}]'
    )


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


def _extract_json_object(text):
    """从模型输出中提取 JSON 对象（行程用）。"""
    if not text:
        return {}
    m = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.S)
    body = m.group(1) if m else text
    a, b = body.find('{'), body.rfind('}')
    if a != -1 and b > a:
        body = body[a:b + 1]
    try:
        obj = json.loads(body)
        return obj if isinstance(obj, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _parse_places(text):
    """把模型返回的 JSON 数组文本规整为景点列表。"""
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


# ---------------- 行程生成 / 调整 ----------------
def _itinerary_prompt(city, days, budget, preferences):
    pref = (preferences or '').strip() or '无'
    return (
        '你是旅行行程规划师。为「' + city + '」生成 ' + str(days) + ' 天行程，'
        '预算「' + budget + '」偏好「' + pref + '」。'
        '输出严格 JSON，不要 Markdown 和多余文字；title≤8字、place≤10字、transit≤12字（简短但不省略信息）。'
        '格式：{"title":"xx","days":[{"day":1,"label":"抵达日","events":['
        '{"local":"09:00","title":"抵达","place":"机场","transit":"机场快线40分","tag":"交通"}]}]}'
        '（无 note 字段）。规则：每天 5-7 个事件、local 升序、tag 取 景点/美食/交通/住宿/休憩/夜景/购物；'
        '首日含到达、末日含离开、每天含用餐与住宿；不走回头路、相邻景点标注交通耗时；'
        '经济→免费景点+公交，舒适→含门票+打车，豪华→高消费体验；天越长越松、越短越紧凑。'
        '只输出 JSON 对象。'
    )


def _normalize_itinerary(data, city, days, budget):
    """校验并规整智谱返回的行程为前端 DATA.trip 同构；不合格抛错。"""
    if not isinstance(data, dict):
        raise Exception('行程格式非法：非对象')
    days_list = data.get('days') or []
    if not isinstance(days_list, list) or not days_list:
        raise Exception('行程缺少 days')
    out_days = []
    for d in days_list:
        if not isinstance(d, dict):
            continue
        events = d.get('events') or []
        if not isinstance(events, list):
            continue
        evs = []
        for e in events:
            if not isinstance(e, dict):
                continue
            local = str(e.get('local') or '').strip()
            title = str(e.get('title') or '').strip()
            if not local or not title:
                continue
            evs.append({
                'local': local[:5],
                'title': title[:40],
                'place': str(e.get('place') or '')[:30],
                'transit': str(e.get('transit') or '')[:30],
                'tag': str(e.get('tag') or '景点')[:6],
                'verified': True,
                'note': str(e.get('note') or '')[:60],
            })
        if not evs:
            continue
        evs.sort(key=lambda x: _time_to_min(x['local']))
        out_days.append({
            'day': int(d.get('day') or (len(out_days) + 1)),
            'label': str(d.get('label') or ('第 %d 天' % (len(out_days) + 1)))[:20],
            'note': str(d.get('note') or '')[:30],
            'events': evs,
        })
    if not out_days:
        raise Exception('行程事件为空')
    return {
        'title': str(data.get('title') or (city + ' ' + str(days) + ' 日 · ' + budget))[:30],
        'dest': city,
        'tz': 'UTC+9',      # 占位；真实时区由前端天气数据驱动双时钟
        'homeTz': 'UTC+8',
        'range': '',
        'days': out_days[:days],
    }


def _generate_itinerary(city, days, budget, preferences, key):
    """智谱生成完整每日行程；失败抛错（由调用方兜底回退）。

    Vercel Hobby 函数 10s 硬限：必须把智谱输出压到 ~1024 token（每天 4-5 事件、字段极简），
    请求超时 8s，给冷启动留余量。
    """
    text = _zhipu_chat(_itinerary_prompt(city, days, budget, preferences), key,
                       max_tokens=2560, timeout=50)
    return _normalize_itinerary(_extract_json_object(text), city, days, budget)


def _adjust_itinerary(city, instruction, itinerary, days, budget, key):
    """根据用户实时反馈，重新生成调整后的完整行程。"""
    prompt = (
        '你是旅行行程调整助手。用户当前行程 JSON：\n' +
        json.dumps(itinerary, ensure_ascii=False) +
        '\n\n用户的新需求：' + instruction +
        '\n\n请输出调整后的完整行程 JSON（结构与原来完全一致：title、days[].day/label/note/events[]，'
        'events 每项含 local/title/place/transit/tag/verified）。只改动受需求影响的部分，其余保持不变；'
        '保持每天 5-8 个事件、时间升序、tag 规范。只输出 JSON 对象，不要 Markdown。'
    )
    text = _zhipu_chat(prompt, key, max_tokens=2560, timeout=50)
    return _normalize_itinerary(_extract_json_object(text), city, days, budget)


def _places_from_itinerary(it):
    """从生成的行程里抽取景点概况（供 live-panel 展示）。"""
    out = []
    seen = set()
    for d in it.get('days', []):
        for e in d.get('events', []):
            if e.get('tag') not in TOURISM_TAGS:
                continue
            t = (e.get('title') or '').strip()
            if not t or t.lower() in seen:
                continue
            seen.add(t.lower())
            out.append({
                'name': t,
                'kind': e.get('tag') or '景点',
                'desc': (e.get('note') or '')[:60],
                'rate': 0,
            })
    return out


# ---------------- Gemini（可选兜底） ----------------
def _http_err_detail(e):
    """从 urllib HTTPError 里提取服务端返回的错误信息（便于定位根因）。"""
    try:
        raw = e.read().decode('utf-8')
    except Exception:  # noqa: BLE001
        return ''
    try:
        msg = json.loads(raw).get('error', {}).get('message', '')
        return msg if msg else raw[:160]
    except Exception:  # noqa: BLE001
        return raw[:160]


def _gemini_json(prompt, key, max_tokens=1024, timeout=12):
    """调用 Gemini 生成内容并返回原始文本。

    认证顺序（2026-08：Google 已把 key 从 AIza 迁移到 AQ. 新格式）：
      1. 原生 generateContent（x-goog-api-key header / ?key= query）—— AQ. 与 AIza 均支持
      2. OpenAI 兼容端点（Bearer）—— 仅旧 AIza key 可用，AQ. key 在此路径会报错，仅兜底
    模型名按 GEMINI_MODELS 依次尝试。错误会带上 Google 返回的具体 message。
    """
    errors = []

    # 1) 原生 generateContent（header / query 两种认证 × 多个模型）
    payload = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'temperature': 0.7, 'maxOutputTokens': max_tokens},
    }
    body = json.dumps(payload).encode('utf-8')
    for model in GEMINI_MODELS:
        base = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent'
        for auth in ('header', 'query'):
            url = base
            headers = {'Content-Type': 'application/json'}
            if auth == 'header':
                headers['x-goog-api-key'] = key
            else:
                url += '?key=' + urllib.parse.quote(key)
            try:
                req = urllib.request.Request(url, data=body, headers=headers)
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    d = json.loads(r.read().decode('utf-8'))
                parts = d.get('candidates', [{}])[0].get('content', {}).get('parts', [])
                if parts:
                    return parts[0].get('text', '')
                errors.append(model + '/' + auth + ': 空响应')
            except urllib.error.HTTPError as e:
                errors.append(model + '/' + auth + ': HTTP ' + str(e.code) + ' ' + _http_err_detail(e))
            except Exception as e:  # noqa: BLE001
                errors.append(model + '/' + auth + ': ' + str(e))

    # 2) OpenAI 兼容端点（仅旧 AIza key 可用，AQ. key 在此路径失败，故放最后兜底）
    url1 = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    payload1 = {
        'model': GEMINI_MODELS[0],
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.7,
        'max_tokens': max_tokens,
    }
    try:
        req = urllib.request.Request(
            url1, data=json.dumps(payload1).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode('utf-8'))
        return data['choices'][0]['message']['content']
    except urllib.error.HTTPError as e:
        errors.append('openai端点: HTTP ' + str(e.code) + ' ' + _http_err_detail(e))
    except Exception as e:  # noqa: BLE001
        errors.append('openai端点: ' + str(e))

    raise Exception('; '.join(errors) or 'Gemini 调用失败')


def _places_by_gemini(city, key):
    return _parse_places(_gemini_json(_places_prompt(city), key))


# ---------------- 入口 ----------------
def _run(params):
    name = (params.get('name') or [''])[0].strip()
    if not name:
        return {'ok': False, 'error': 'missing_name', 'message': '缺少城市参数 name'}

    # 行程参数
    days = 3
    raw_days = (params.get('days') or [''])[0].strip()
    if raw_days.isdigit():
        days = max(1, min(7, int(raw_days)))
    budget = (params.get('budget') or ['舒适'])[0].strip() or '舒适'
    preferences = (params.get('preferences') or [''])[0].strip()
    want_itinerary = bool(params.get('days'))  # 传了 days 才生成完整行程

    qw = _key('QWEATHER_KEY')          # 和风天气（推荐，国内直连，腾讯云场景稳）
    owm = _key('OPEN_WEATHER_MAP_KEY') # OpenWeatherMap（备选，海外可能被墙/风控）
    zh = _key('ZHIPU_API_KEY')
    gem = _key('GEMINI_API_KEY')
    if not qw and not owm and not zh and not gem:
        return {'ok': False, 'error': 'no_keys',
                'message': '后端未配置 API key，已回退本地演示数据'}

    result = {'ok': True, 'city': name, 'days': days, 'budget': budget}

    # 坐标（展示用；和风天气会返回更准的坐标并覆盖）
    if owm and not qw:
        try:
            g = _owm_geocode(name, owm)
            if g:
                result['coords'] = {'lon': g['lon'], 'lat': g['lat']}
        except Exception:  # noqa: BLE001
            pass

    # 天气 / 行程(或景点) 并行
    with ThreadPoolExecutor(max_workers=2) as ex:
        if qw:
            f_weather = ex.submit(_qweather, name, qw, _key('QWEATHER_HOST'))
        elif owm:
            f_weather = ex.submit(_weather, name, result.get('coords'), owm)
        else:
            f_weather = None
        if zh and want_itinerary:
            f_content = ex.submit(_generate_itinerary, name, days, budget, preferences, zh)
        elif zh:
            f_content = ex.submit(_parse_places, _zhipu_chat(_places_prompt(name), zh, max_tokens=1024))
        elif gem:
            f_content = ex.submit(_places_by_gemini, name, gem)
        else:
            f_content = None

        if f_weather:
            try:
                w = f_weather.result()
                if isinstance(w, dict) and w.get('coords'):
                    result['coords'] = {'lon': w['coords']['lon'], 'lat': w['coords']['lat']}
                result['weather'] = w
            except Exception as e:  # noqa: BLE001
                result['weather'] = {'error': str(e)}

        if f_content:
            try:
                content = f_content.result()
                if want_itinerary:
                    result['itinerary'] = content
                    result['has_itinerary'] = True
                    result['places'] = _places_from_itinerary(content)
                else:
                    result['places'] = content
                result['places_source'] = 'zhipu' if zh else 'gemini'
            except Exception as e:  # noqa: BLE001
                result['places'] = []
                if want_itinerary:
                    result['itinerary_error'] = str(e)
                else:
                    result['places_error'] = str(e)
        else:
            result['places'] = []
            result['geo_note'] = '未配置大模型 key（智谱 ZHIPU_API_KEY 或 Gemini），无法生成行程（天气/时区仍可用）'

    result['has_places'] = bool(result.get('places'))
    return result


def _handle_adjust(req):
    """POST /api/adjust：按用户指令调整当前行程。"""
    zh = _key('ZHIPU_API_KEY')
    if not zh:
        return {'ok': False, 'error': 'no_keys', 'message': '后端未配置智谱 key'}
    city = (req.get('city') or '').strip()
    instruction = (req.get('instruction') or '').strip()
    itinerary = req.get('itinerary') or {}
    if not city or not instruction or not isinstance(itinerary, dict) or not itinerary.get('days'):
        return {'ok': False, 'error': 'bad_request', 'message': '缺少参数 city/instruction/itinerary'}
    days = len(itinerary.get('days') or [])
    budget = (req.get('budget') or '舒适').strip() or '舒适'
    try:
        new_it = _adjust_itinerary(city, instruction, itinerary, days, budget, zh)
        return {'ok': True, 'itinerary': new_it, 'places': _places_from_itinerary(new_it)}
    except Exception as e:  # noqa: BLE001
        return {'ok': False, 'error': 'adjust_failed', 'message': str(e)}


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in _cors().items():
            self.send_header(k, v)
        self.end_headers()

    def _reply(self, body_obj):
        payload = json.dumps(body_obj, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        for k, v in _cors().items():
            self.send_header(k, v)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        try:
            body = _run(params)
        except Exception as e:  # noqa: BLE001
            body = {'ok': False, 'error': 'server_error', 'message': str(e)}
        self._reply(body)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b''
        try:
            req = json.loads(raw.decode('utf-8')) if raw else {}
        except Exception:  # noqa: BLE001
            req = {}
        path = parsed.path.rstrip('/')
        try:
            if path == '/api/adjust':
                body = _handle_adjust(req)
            else:
                body = {'ok': False, 'error': 'not_found', 'message': '未知端点 ' + path}
        except Exception as e:  # noqa: BLE001
            body = {'ok': False, 'error': 'server_error', 'message': str(e)}
        self._reply(body)

    def log_message(self, *args):  # 静默访问日志，避免噪声
        pass


# =========================================================
# 腾讯云云函数 SCF（Web 函数）入口 —— 与 Vercel 共用同一份业务逻辑
# 部署到腾讯云时入口函数名设为 main_handler；国内直连智谱、时限可配 60s+，
# 解决 Vercel 免费层 10s 硬限装不下完整行程的问题。
# =========================================================
def _scf_reply(result, status=200):
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
        'body': json.dumps(result, ensure_ascii=False),
        'isBase64Encoded': False,
    }


def main_handler(event, context):
    """腾讯云 SCF 事件函数入口（兼容函数 URL / Web 函数事件）。"""
    method = (event.get('httpMethod') or event.get('method') or 'GET').upper()
    path = event.get('path') or '/'
    body_raw = event.get('body') or ''
    query = event.get('queryString') or event.get('queryStringParameters') or {}

    if method == 'OPTIONS':  # 预检
        return {'statusCode': 204, 'headers': _cors(), 'body': ''}

    # 诊断端点：先确认函数活着 + 环境变量配置状态
    if method == 'GET' and path.rstrip('/') == '/api/ping':
        return _scf_reply(_ping())

    # 归一化 query 为 {k: [v]}（_run 期望 list 值）
    params = {}
    for k, v in (query or {}).items():
        params[k] = [v] if isinstance(v, str) else (v if isinstance(v, list) else [str(v)])

    # POST body 解析
    req = {}
    if method == 'POST' and body_raw:
        try:
            req = json.loads(body_raw) if isinstance(body_raw, str) else (body_raw or {})
        except Exception:  # noqa: BLE001
            req = {}

    try:
        if method == 'POST' and path.rstrip('/') == '/api/adjust':
            result = _handle_adjust(req)
        else:
            result = _run(params)
    except Exception as e:  # noqa: BLE001
        result = {'ok': False, 'error': 'server_error', 'message': str(e)}

    # 打印到 stdout，腾讯云 SCF 会抓进日志（配合日志投递查看）
    print('[gooh] %s %s -> %s %s' % (
        method, path, result.get('ok'), result.get('error') or ''), flush=True)
    return _scf_reply(result)
