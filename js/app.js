/* =========================================================
 * Gooh旅记 · 改进版 Demo —— 走查交互 (js/app.js)
 *
 * 职责：
 *   1. 模板 token 替换 + 各屏渲染（数据来自 js/data.js）
 *   2. 走查状态机：上一屏 / 下一屏 / 章节点 / 键盘 ← →
 *   3. S3 双时钟时间轴 + 实时对照时钟
 *   4. S4 AI 快进：解析步骤动画 + 一键并入时间轴
 *   5. S5 手动补录：滑块补录 + 可信度报告
 * ========================================================= */
(function () {
  'use strict';

  var DATA = window.DATA;
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  /* ---------------- 模板 token 替换 ---------------- */
  var TOKENS = {
    reviewCount:   function () { return DATA.product.reviewCount; },
    painCount:     function () { return DATA.product.painCount; },
    fixCount:      function () { return DATA.product.fixCount; },
    aiSource:      function () { return DATA.ai.source; },
    aiConstraints: function () { return DATA.ai.constraints; },
    price:         function () { return DATA.pricing.price; },
  };
  function fillTokens() {
    document.body.innerHTML = document.body.innerHTML.replace(/\{\{(\w+)\}\}/g, function (m, k) {
      return TOKENS[k] ? TOKENS[k]() : m;
    });
  }

  /* ---------------- 工具 ---------------- */
  // 东京 UTC+9 → 北京 UTC+8：减 1 小时
  function toHome(local) {
    var p = local.split(':');
    var m = (parseInt(p[0], 10) * 60 + parseInt(p[1], 10) - 60 + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function timeToMin(t) { var p = t.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
  var stars = { 1: '★', 2: '★★' };

  /* ---------------- 状态 ---------------- */
  var screens = [];
  var titles = [];
  var cur = 0;
  var activeDay = 1;
  var state = { aiParsed: false, aiMerged: false, recorded: false, input: null, live: null, trip: null, chat: [] };

  /* ---------------- 生成结果概览条（S2–S6 顶部） ---------------- */
  function renderGenSummary() {
    var s = state.input || { dest: '东京', budget: '舒适' };
    $('#gen-summary-meta').innerHTML =
      '📍 生成结果 · <b>' + s.dest + '</b> · ' + s.budget + ' · ' + DATA.trip.range;
  }

  /* ---------------- 走查状态机 ---------------- */
  function goTo(i) {
    cur = Math.max(0, Math.min(screens.length - 1, i));
    screens.forEach(function (s, idx) {
      s.classList.toggle('is-active', idx === cur);
    });
    $('#screen-title').textContent = (cur + 1) + ' / ' + screens.length + ' · ' + titles[cur];
    $('#walk-current').textContent = cur + 1;
    $('#btn-prev').disabled = cur === 0;
    $('#btn-next').disabled = cur === screens.length - 1;
    renderDots();
    var summary = $('#gen-summary');
    summary.classList.toggle('is-visible', cur >= 1);
    if (cur >= 1) renderGenSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderDots() {
    $('#walk-progress-dots').innerHTML = screens.map(function (_, i) {
      return '<span class="dot' + (i === cur ? ' is-on' : '') + (i < cur ? ' is-done' : '') + '"></span>';
    }).join('');
  }

  /* ---------------- S6 差评墙（证据链，结果页底部收尾） ---------------- */
  function renderReviewWall() {
    var wall = $('#review-wall');
    if (!wall) return;
    wall.innerHTML = DATA.reviews.map(function (r) {
      return '<article class="review">' +
        '<div class="review-top">' +
          '<span class="review-stars">' + stars[r.star] + '</span>' +
          '<span class="chip chip-ker">' + r.type + '</span>' +
          '<span class="kano ' + r.kanoClass + '">' + r.kano + '</span>' +
        '</div>' +
        '<p>' + r.text + '</p>' +
        '<div class="review-user">— ' + r.user + '</div>' +
      '</article>';
    }).join('');
    var legend = $('#kano-legend');
    if (legend) legend.innerHTML = DATA.kanoLegend.map(function (k) {
      return '<span class="kano ' + k.key + '">' + k.label + '</span>';
    }).join('');
  }

  /* ---------------- S1 懒人攻略生成器：输入 → 生成 ---------------- */
  function renderGenHot() {
    $('#gen-hot').innerHTML = DATA.hotDests.map(function (d) {
      return '<button type="button" class="hot-chip' + (d === '东京' ? ' is-on' : '') + '">' + d + '</button>';
    }).join('');
  }
  function getBudget() {
    var on = document.querySelector('#gen-budget .is-on');
    return on ? on.getAttribute('data-v') : '舒适';
  }
  function runGenerate() {
    var dest = $('#gen-dest').value.trim() || '东京';
    var budget = getBudget();
    var date = $('#gen-date').value || '2026-08-20';
    var days = parseInt($('#gen-days').value, 10);
    if (!days || days < 1 || days > 7) days = 3;
    var pref = $('#gen-pref').value.trim();
    state.input = { dest: dest, budget: budget, date: date, days: days, pref: pref };
    state.live = null; // 实时查询结果，失败/无 key 时保持 null（走回退）

    var overlay = $('#gen-overlay');
    var stepsEl = $('#gen-steps');
    stepsEl.innerHTML = '';
    var steps = [
      '识别目的地时区 · ' + dest,
      '匹配预算档位 · ' + budget,
      '分析人数 / 人物关系 / 出行偏好',
      '排入时间轴 · 双时钟校时',
    ];
    steps.forEach(function (s, i) {
      var li = document.createElement('div');
      li.className = 'gen-step';
      li.innerHTML = '<span>' + (i + 1) + '</span><b>' + s + '</b>';
      stepsEl.appendChild(li);
      setTimeout(function () { li.classList.add('is-done'); }, 300 + i * 420);
    });
    var t0 = 300 + steps.length * 420 + 200;
    setTimeout(function () {
      stepsEl.insertAdjacentHTML('beforeend',
        '<div class="gen-done">✅ 已生成《' + dest + '攻略 · ' + budget + '游》</div>');
    }, t0);
    overlay.classList.add('is-open');

    // 实时查询（P0 打通链路）：异步，不阻塞遮罩动画；无 key / 失败自动回退本地数据
    renderLivePanel('loading');
    queryCity(dest, days, budget, pref).then(function (live) {
      state.live = live;
      applyLiveData(live);
      renderLivePanel(live);
    });

    setTimeout(function () {
      overlay.classList.remove('is-open');
      goTo(1); // 跳到第一个结果页
    }, t0 + 1300);
  }

  /* ---------------- P0 实时查询（任意城市） ---------------- */
  function queryCity(name, days, budget, pref) {
    var base = window.CONFIG && window.CONFIG.API_BASE;
    if (!base || base.indexOf('你的') > -1) return Promise.resolve({ skipped: true }); // 未配置 → 不打扰
    var url = base.replace(/\/+$/, '') + '/api?name=' + encodeURIComponent(name) +
      '&days=' + (days || 3) + '&budget=' + encodeURIComponent(budget || '舒适') +
      '&preferences=' + encodeURIComponent(pref || '');
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : { ok: false, message: '后端 HTTP ' + r.status }; })
      .then(function (d) {
        if (!d) return { ok: false, message: '后端返回异常' };
        return d.ok ? d : { ok: false, message: d.message || d.error || '后端查询失败' };
      })
      .catch(function () { return { ok: false, message: '无法连接后端，请检查网络' }; });
  }

  function renderLivePanel(live) {
    var panel = $('#live-panel');
    if (!panel) return;
    if (!live || live.skipped) { // 未查询 / 未配置 → 隐藏
      panel.style.display = 'none';
      panel.className = 'card live-panel';
      return;
    }
    panel.style.display = '';
    if (live === 'loading') {
      panel.className = 'card live-panel is-fallback';
      panel.innerHTML = '<div class="live-head">📡 正在查询 <b>' +
        (state.input ? state.input.dest : '该城市') + '</b> 的实时数据…</div>';
      return;
    }
    if (!live.ok) {
      panel.className = 'card live-panel is-fallback';
      panel.innerHTML = '<div class="live-head">📡 实时查询不可用</div>' +
        '<div class="live-weather">' + (live.message || live.error || '未配置 API key / 网络异常') +
        ' · 已回退本地演示数据</div>';
      return;
    }
    panel.className = 'card live-panel is-live';
    var html = '<div class="live-head">🎯 实时查询 · <b>' + live.city + '</b></div>';
    var w = live.weather;
    if (w && !w.error) {
      var tz = w.tz_offset != null
        ? 'UTC' + (w.tz_offset >= 0 ? '+' : '') + (w.tz_offset / 3600) : '';
      var diff = w.tz_offset != null
        ? ' · 与北京 ' + ((w.tz_offset - 28800) / 3600 >= 0 ? '+' : '') + ((w.tz_offset - 28800) / 3600) + ' 小时' : '';
      html += '<div class="live-weather">🌤 ' + w.desc + ' · ' + w.temp + '℃' +
        (tz ? ' · ' + tz : '') + diff + '</div>';
    } else if (w && w.error) {
      html += '<div class="live-weather">天气获取失败：' + w.error + '</div>';
    }
    if (live.coords) {
      html += '<div class="live-coords">📍 ' + live.coords.lat.toFixed(4) + ', ' + live.coords.lon.toFixed(4) + '</div>';
    }
    if (live.places && live.places.length) {
      html += '<div class="live-places-title">🗺 已查到 ' + live.places.length + ' 个景点：</div>' +
        '<div class="live-places">' + live.places.map(function (p) {
          return '<div class="live-place"><b>' + p.name + '</b>' +
            (p.rate ? '<span class="live-rate">★' + p.rate + '</span>' : '') +
            (p.kind && p.kind !== '景点' ? '<span class="live-kind">' + p.kind + '</span>' : '') +
            (p.desc ? '<span class="live-desc">' + p.desc + '</span>' : '') + '</div>';
        }).join('') + '</div>';
    } else {
      html += '<div class="live-empty">暂无景点数据（配置 ZHIPU_API_KEY 后可生成）</div>';
    }
    panel.innerHTML = html;
  }

  /* ---------------- 应用后端生成的完整行程 ---------------- */
  function applyItinerary(it) {
    if (!it || !it.days || !it.days.length) return;
    var d = state.input ? state.input.date : '';
    it.range = it.range || (d ? d.replace(/-/g, '.') + ' 起 · ' + it.days.length + ' 日' : '');
    state.trip = it;
    renderTimeline();
  }

  function applyLiveData(live) {
    if (!live) return;
    if (live.ok && live.itinerary) applyItinerary(live.itinerary);
  }

  /* ---------------- S1 偏好快捷 chips ---------------- */
  var PREF_PRESETS = ['带父母', '全程地铁', '少走路', '美食为主', '轻松慢游', '夜景为主'];
  function renderGenPrefChips() {
    var box = $('#gen-pref-chips');
    if (!box) return;
    box.innerHTML = PREF_PRESETS.map(function (p) {
      return '<button type="button" class="hot-chip" data-pref="' + p + '">' + p + '</button>';
    }).join('');
  }

  /* ---------------- AI 小助手（实时反馈调整行程） ---------------- */
  var CHAT_KEY = 'gooh_ai_chat';
  function loadChat() {
    try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || []; } catch (e) { return []; }
  }
  function saveChat(chat) {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(chat)); } catch (e) {}
  }
  function renderChat() {
    var body = $('#ai-chat-body');
    if (!body) return;
    body.innerHTML = state.chat.length
      ? state.chat.map(function (m) {
          return '<div class="chat-msg ' + (m.role === 'user' ? 'is-user' : 'is-ai') + '">' + m.text + '</div>';
        }).join('')
      : '<div class="chat-empty">说点什么，我帮你调整行程～<br/>如：明天加一个免税店 / 今天下午改轻松一点</div>';
    body.scrollTop = body.scrollHeight;
  }
  function openChat() {
    $('#ai-chat').classList.add('is-open');
    $('#ai-chat').setAttribute('aria-hidden', 'false');
    renderChat();
    $('#ai-chat-text').focus();
  }
  function closeChat() {
    $('#ai-chat').classList.remove('is-open');
    $('#ai-chat').setAttribute('aria-hidden', 'true');
  }
  function sendChat() {
    var input = $('#ai-chat-text');
    var text = input.value.trim();
    if (!text) return;
    state.chat.push({ role: 'user', text: text });
    saveChat(state.chat);
    renderChat();
    input.value = '';

    // 未生成行程（还在东京演示数据）→ 提示先生成
    if (!state.trip || state.trip === DATA.trip) {
      state.chat.push({ role: 'ai', text: '还没有 AI 生成的行程。请先在第 1 屏输入城市、点「一键生成攻略」，再来调整～' });
      saveChat(state.chat); renderChat(); return;
    }
    var base = window.CONFIG && window.CONFIG.API_BASE;
    if (!base || base.indexOf('你的') > -1) {
      state.chat.push({ role: 'ai', text: '后端未配置 API_BASE，请先部署 Vercel。' });
      saveChat(state.chat); renderChat(); return;
    }
    var payload = {
      city: (state.input && state.input.dest) || '东京',
      instruction: text,
      itinerary: state.trip,
      budget: (state.input && state.input.budget) || '舒适',
    };
    fetch(base.replace(/\/+$/, '') + '/api/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.itinerary) {
          applyItinerary(d.itinerary);
          state.chat.push({ role: 'ai', text: '已调整 ✅ 时间轴已更新，看看是否符合你的要求～' });
        } else {
          state.chat.push({ role: 'ai', text: '请稍后重试（' + ((d && (d.message || d.error)) || '调整失败') + '）' });
        }
        saveChat(state.chat); renderChat();
      })
      .catch(function () {
        state.chat.push({ role: 'ai', text: '请稍后重试（网络异常，未影响当前行程）' });
        saveChat(state.chat); renderChat();
      });
  }

  /* ---------------- S2 时区识别 ---------------- */
  function renderTzSelector() {
    $('#tz-city').innerHTML = DATA.tzCities.map(function (c, i) {
      return '<option value="' + i + '"' + (i === 0 ? ' selected' : '') + '>' + c.name + ' · ' + c.tz + '</option>';
    }).join('');
    updateTzCard(0);
    $('#tz-city').addEventListener('change', function () {
      updateTzCard(parseInt(this.value, 10));
    });
  }
  function updateTzCard(i) {
    var c = DATA.tzCities[i];
    var home = DATA.time.home;
    $('#tz-card').innerHTML =
      '<div class="tz-ok">✓ 时区安全已开启</div>' +
      '<h3>' + c.name + '<span class="tz-tag">' + c.tz + '</span></h3>' +
      '<div class="tz-row"><span>与家乡 ' + home.name + ' 的时差</span><b>' + c.diff + '</b></div>' +
      '<div class="tz-row"><span>当地日照</span><b>日出 ' + c.sun.rise + ' · 日落 ' + c.sun.set + '</b></div>' +
      '<div class="tz-row"><span>双时钟对照</span><b>自动换算 · 实时更新</b></div>' +
      '<p class="tz-note">行程的每一条，都会同时显示「' + c.name + ' 当地时间」与「' + home.name + ' 时间」。</p>';
  }

  /* ---------------- S3 双时钟时间轴 ---------------- */
  var fTokyo   = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' });
  var fBeijing = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtOffset(offsetSec) {
    // 根据 UTC 偏移（秒）显示「当地此刻」，任意城市通用
    var now = new Date();
    var utcMs = now.getTime() + now.getTimezoneOffset() * 60000 + offsetSec * 1000;
    var d = new Date(utcMs);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
  function renderClock() {
    var d = new Date();
    var w = state.live && state.live.ok && state.live.weather;
    if (w && w.tz_offset != null) {
      $('#clock-dest').textContent = fmtOffset(w.tz_offset); // 目的地当地时间
      $('.clock-dest .clock-city').textContent = state.live.city + ' · UTC' +
        (w.tz_offset >= 0 ? '+' : '') + (w.tz_offset / 3600);
    } else {
      $('#clock-dest').textContent = fTokyo.format(d);        // 演示 fallback：东京
      $('.clock-dest .clock-city').textContent = '东京 · UTC+9';
    }
    $('#clock-home').textContent = fBeijing.format(d);
    $('.clock-home .clock-city').textContent = '北京 · UTC+8';
    renderNowLine(); // 「现在」时刻线随时钟每秒更新
  }

  function renderTimeline() {
    var trip = state.trip || DATA.trip;
    var days = trip.days;
    if (activeDay > days.length) activeDay = 1; // 生成的行程天数可能少于 5
    var day = days[activeDay - 1];
    $('#trip-meta').textContent = trip.title + ' · ' + (trip.range || '');
    $('#day-tabs').innerHTML = days.map(function (d) {
      return '<button class="day-tab' + (d.day === activeDay ? ' is-active' : '') + '" data-day="' + d.day + '">' +
        '<b>D' + d.day + '</b>' +
        '<span class="day-label">' + d.label + '</span>' +
        '<span class="day-note">' + d.note + '</span>' +
        (d.tzNote ? '<span class="chip chip-tz">时差衔接</span>' : '') +
      '</button>';
    }).join('');
    $('#day-panel').innerHTML =
      (day.tzNote ? '<div class="tz-banner">🌗 ' + day.tzNote + '</div>' : '') +
      day.events.map(eventCard).join('');
    renderNowLine();
  }

  /* 当前东京时刻（分钟） */
  function tokyoNowMin() {
    var p = fTokyo.format(new Date()).split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }
  /* 「现在」时刻线：演示锚定 D1（正在发生的「今天」），随实时时钟移动 */
  function renderNowLine() {
    var panel = $('#day-panel');
    panel.querySelectorAll('.now-line').forEach(function (x) { x.remove(); });
    if (activeDay !== 1) return; // 演示锚定 D1，保证任何时候走查都能看到「现在」线
    var trip = state.trip || DATA.trip;
    var evs = trip.days[0].events;
    var nowMin = tokyoNowMin();
    var idx = 0;
    while (idx < evs.length && timeToMin(evs[idx].local) < nowMin) idx++;
    var line = document.createElement('div');
    line.className = 'now-line';
    line.innerHTML = '<span class="now-tag">● 现在 · 东京 ' +
      String(Math.floor(nowMin / 60)).padStart(2, '0') + ':' + String(nowMin % 60).padStart(2, '0') + '</span>';
    var refs = panel.querySelectorAll('.evt');
    panel.insertBefore(line, refs[idx] || null);
  }
  function eventCard(e) {
    var home = toHome(e.local);
    var tagCls = e.isNew ? 'chip-ai' : 'chip-tag';
    var okText = e.verified ? '✓ 已确认' : '⏳ 待确认';
    var okCls = e.verified ? 'chip-ok' : 'chip-pending';
    var metro = e.metro
      ? '<div class="evt-metro">🚇 ' + e.metro.line + ' · 首班 ' + e.metro.first +
        ' · 末班 ' + e.metro.last + (e.metro.transfer ? ' · <b>' + e.metro.transfer + '</b>' : '') + '</div>'
      : '';
    var note = e.note
      ? '<div class="evt-note" hidden>' + (e.isNew ? '<span class="note-tag">AI 推荐</span> ' : '') + e.note + '</div>'
      : '';
    return '<article class="evt' + (e.isNew ? ' is-new' : '') + (e.note ? ' has-note' : '') + '">' +
      '<div class="evt-time">' +
        '<div class="t-local">' + e.local + '</div>' +
        '<div class="t-home">北京 ' + home + '</div>' +
      '</div>' +
      '<div class="evt-body">' +
        '<h4>' + e.title + '</h4>' +
        '<div class="evt-meta">' +
          (e.place ? '<span>📍 ' + e.place + '</span>' : '') +
          (e.transit && e.transit !== '-' ? '<span>🚇 ' + e.transit + '</span>' : '') +
          (e.tag ? '<span class="chip ' + tagCls + '">' + e.tag + '</span>' : '') +
          '<span class="chip ' + okCls + '">' + okText + '</span>' +
          (e.note ? '<span class="note-hint">💬 点开看备注</span>' : '') +
        '</div>' +
        metro +
        note +
      '</div>' +
    '</article>';
  }

  /* ---------------- S4 AI 快进 ---------------- */
  function renderAIStatic() {
    $('#ai-messy').textContent = DATA.ai.messy;
    $('#ai-philosophy').innerHTML = '<h3>为什么这样设计</h3>' + DATA.ai.philosophy.map(function (p) {
      return '<div class="phi"><b>' + p.t + '</b><p>' + p.d + '</p></div>';
    }).join('');
    resetAIResult();
  }
  function resetAIResult() {
    state.aiParsed = false;
    $('#ai-steps').innerHTML = '';
    $('#ai-result').innerHTML = '<p class="empty">点击「开始解析」，看它如何把乱信息变成结构化行程。</p>';
    $('#ai-run-btn').disabled = false;
    $('#ai-run-btn').textContent = '▶ 开始解析';
    $('#ai-merge-btn').disabled = true;
    $('#ai-merge-btn').textContent = '一键并入时间轴 →';
  }
  function runAI() {
    if (state.aiParsed) return;
    var btn = $('#ai-run-btn');
    btn.disabled = true;
    var stepsEl = $('#ai-steps');
    stepsEl.innerHTML = '';
    DATA.ai.steps.forEach(function (s, i) {
      var li = document.createElement('div');
      li.className = 'ai-step';
      li.innerHTML = '<span class="ai-step-n">' + (i + 1) + '</span>' +
        '<div class="ai-step-body"><b>' + s.label + '</b><p>' + s.detail + '</p></div>';
      stepsEl.appendChild(li);
      setTimeout(function () { li.classList.add('is-done'); }, 500 + i * 650);
    });
    setTimeout(function () {
      state.aiParsed = true;
      $('#ai-result').innerHTML = DATA.ai.parsed.map(function (p) {
        return '<div class="ai-item">' +
          '<span class="ai-item-day">D' + p.day + ' · ' + p.local + '</span>' +
          '<b>' + p.title + '</b>' +
          '<span class="ai-item-meta">' + p.place + ' · ' + p.transit + '</span>' +
        '</div>';
      }).join('');
      btn.textContent = '✓ 解析完成';
      $('#ai-merge-btn').disabled = false;
    }, 500 + DATA.ai.steps.length * 650 + 300);
  }
  function mergeAI() {
    if (!state.aiParsed || state.aiMerged) return;
    DATA.ai.parsed.forEach(function (p) {
      state.trip.days[p.day - 1].events.push(Object.assign({ isNew: true }, p));
    });
    // 按时间排序，让 AI 条目落入正确的时间位
    state.trip.days.forEach(function (d) {
      d.events.sort(function (a, b) { return timeToMin(a.local) - timeToMin(b.local); });
    });
    state.aiMerged = true;
    $('#ai-merge-btn').textContent = '✓ 已并入时间轴';
    $('#ai-merge-btn').disabled = true;
    activeDay = 2; // 大部分 AI 条目落在 D2
    renderTimeline();
    goTo(2);
  }

  /* ---------------- S5 里程可信 ---------------- */
  function renderMileage() {
    var m = DATA.mileage, l = m.lost;
    $('#mileage-days').innerHTML = m.days.map(function (d) {
      var recorded = (d.day === l.day && l.recorded);
      var km = recorded ? (parseFloat(d.km) + l.km).toFixed(1) : d.km;
      var tagCls = recorded ? 't-record' : 't-real';
      var tagText = recorded ? '估算·补录' : d.tag;
      var lostBadge = (d.day === l.day && !l.recorded)
        ? '<span class="lost-badge">−' + l.km.toFixed(1) + 'km 被吃掉</span>' : '';
      return '<div class="mile-day">' +
        '<span class="mile-day-no">D' + d.day + '</span>' +
        '<b>' + km + ' km</b>' +
        '<span class="trust ' + tagCls + '">' + tagText + '</span>' +
        lostBadge +
      '</div>';
    }).join('');
    renderLost();
    renderReport();
  }
  function renderLost() {
    var m = DATA.mileage, l = m.lost;
    var card = $('#lost-card');
    if (l.recorded) {
      card.classList.add('is-ok');
      card.innerHTML =
        '<div class="lost-ok">✓ 已补录</div>' +
        '<h3>D' + l.day + ' ' + l.start + '–' + l.end + ' ' + l.place + '</h3>' +
        '<p>已手动补录 <b>' + l.km.toFixed(1) + ' km</b>，标记为「估算」。整份行程不再有「假的沉默」。</p>';
      $('#record-card').style.opacity = '.45';
      $('#record-card').style.pointerEvents = 'none';
    } else {
      card.classList.remove('is-ok');
      card.innerHTML =
        '<div class="lost-warn">⚠ 数据被系统吃掉</div>' +
        '<h3>D' + l.day + ' ' + l.start + '–' + l.end + ' ' + l.place + '</h3>' +
        '<p>' + l.reason + '，这段 <b>' + l.km.toFixed(1) + ' km</b> 静默丢失。</p>' +
        '<p class="lost-hint">我们不假装没丢，而是告诉你，并允许你补回来。</p>';
      $('#record-card').style.opacity = '';
      $('#record-card').style.pointerEvents = '';
    }
  }
  function renderReport() {
    var m = DATA.mileage, l = m.lost;
    var html = '<h3>数据可信度报告</h3>';
    if (l.recorded) {
      html += '<div class="report-trust">可信度 <b>' + m.trustBefore + ' → ' + m.trustAfter + '</b></div>' +
        '<p>补录后总里程 <b>' + m.totalAfter + ' km</b>（实测为主，估算已明示）。</p>';
    } else {
      html += '<div class="report-trust">当前可信度 <b>' + m.trustBefore + '</b></div>' +
        '<p>D2 有一段 <b>' + l.km.toFixed(1) + ' km</b> 待补录；补录后预计 <b>' + m.trustAfter + '</b>。</p>';
    }
    $('#trust-report').innerHTML = html;
  }
  function doRecord() {
    if (state.recorded) return;
    state.recorded = true;
    DATA.mileage.lost.recorded = true;
    renderMileage();
  }

  /* ---------------- S6 分享 + 定价 ---------------- */
  function renderPricingShare() {
    var s = DATA.share;
    $('#share-card').innerHTML =
      '<div class="share-top"><span class="share-brand">Gooh旅记</span><span class="share-tz">' + s.tz + '</span></div>' +
      '<h3>' + s.title + '</h3>' +
      '<div class="share-range">' + s.range + '</div>' +
      '<ul class="share-list">' +
        '<li>📍 ' + s.items + '</li>' +
        '<li>✅ ' + s.verified + '</li>' +
        '<li>🕐 双时钟 · 绝不搞错时区</li>' +
      '</ul>' +
      '<div class="share-foot">一张卡片 · 发进家族群</div>';
    $('#pricing-free').innerHTML = DATA.pricing.free.map(function (t) { return '<li>' + t + '</li>'; }).join('');
    $('#pricing-pro').innerHTML = DATA.pricing.pro.map(function (t) { return '<li>' + t + '</li>'; }).join('');
    $('#pricing-why').innerHTML = '<h3>为什么我们这样收费</h3>' + DATA.pricing.why.map(function (w) {
      return '<div class="why"><b>' + w.t + '</b><p>' + w.d + '</p></div>';
    }).join('');
  }

  /* ---------------- 重启（回到初始状态） ---------------- */
  function restart() {
    if (state.aiMerged) {
      state.trip.days.forEach(function (d) {
        d.events = d.events.filter(function (e) { return !e.isNew; });
      });
      state.aiMerged = false;
    }
    state.recorded = false;
    DATA.mileage.lost.recorded = false;
    state.live = null;
    state.trip = DATA.trip; // 回到东京演示数据
    activeDay = 1;
    renderTimeline();
    renderAIStatic();
    renderMileage();
    renderLivePanel();
    goTo(0);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    fillTokens();

    // 必须在 fillTokens 之后获取，否则拿到的可能是被替换掉的旧节点
    screens = $$('.screen');
    titles = screens.map(function (s) { return s.getAttribute('data-title'); });

    state.trip = DATA.trip;   // 当前展示的行程（生成成功后被替换）
    state.chat = loadChat();  // AI 小助手对话历史（localStorage）

    renderReviewWall();
    renderGenHot();
    renderGenPrefChips();
    renderTzSelector();
    renderTimeline();
    renderClock();
    setInterval(renderClock, 1000);
    renderAIStatic();
    renderMileage();
    renderPricingShare();
    renderLivePanel(); // 初始隐藏；runGenerate 触发真实查询后显示

    // 走查导航
    $('#btn-next').addEventListener('click', function () { goTo(cur + 1); });
    $('#btn-prev').addEventListener('click', function () { goTo(cur - 1); });
    $('#btn-restart').addEventListener('click', restart);
    $('#btn-finish').addEventListener('click', restart);
    $('#btn-regenerate').addEventListener('click', restart);
    $$('[data-next]').forEach(function (b) {
      b.addEventListener('click', function () { goTo(cur + 1); });
    });
    document.addEventListener('keydown', function (e) {
      if ($('#gen-overlay').classList.contains('is-open')) return;
      if (e.key === 'ArrowRight') goTo(cur + 1);
      if (e.key === 'ArrowLeft') goTo(cur - 1);
    });

    // S1 生成入口
    $('#btn-generate').addEventListener('click', runGenerate);
    $('#gen-hot').addEventListener('click', function (e) {
      var c = e.target.closest('.hot-chip');
      if (!c) return;
      $('#gen-dest').value = c.textContent;
      $$('#gen-hot .hot-chip').forEach(function (x) { x.classList.toggle('is-on', x === c); });
    });
    $('#gen-budget').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b) return;
      $$('#gen-budget button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    });
    $('#gen-pref-chips').addEventListener('click', function (e) {
      var c = e.target.closest('.hot-chip');
      if (!c) return;
      $('#gen-pref').value = c.getAttribute('data-pref');
      $$('#gen-pref-chips .hot-chip').forEach(function (x) { x.classList.toggle('is-on', x === c); });
    });

    // S3 日签切换
    $('#day-tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.day-tab');
      if (!t) return;
      activeDay = parseInt(t.getAttribute('data-day'), 10);
      renderTimeline();
    });

    // S3 行程备注展开（点击卡片）
    $('#day-panel').addEventListener('click', function (e) {
      var evt = e.target.closest('.evt');
      if (!evt || !evt.classList.contains('has-note')) return;
      var note = evt.querySelector('.evt-note');
      if (!note) return;
      note.hidden = !note.hidden;
      evt.classList.toggle('is-open', !note.hidden);
    });

    // S4 AI
    $('#ai-run-btn').addEventListener('click', runAI);
    $('#ai-merge-btn').addEventListener('click', mergeAI);

    // S5 补录
    var slider = $('#record-slider');
    slider.addEventListener('input', function () {
      $('#record-val').textContent = parseFloat(slider.value).toFixed(1) + ' km';
    });
    $('#record-btn').addEventListener('click', doRecord);

    // AI 小助手（实时反馈调整）
    $('#ai-fab').addEventListener('click', openChat);
    $('#ai-chat-close').addEventListener('click', closeChat);
    $('#ai-chat-send').addEventListener('click', sendChat);
    $('#ai-chat-text').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendChat();
    });

    goTo(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
