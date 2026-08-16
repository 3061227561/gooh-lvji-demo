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
  var state = { aiParsed: false, aiMerged: false, recorded: false };

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderDots() {
    $('#walk-progress-dots').innerHTML = screens.map(function (_, i) {
      return '<span class="dot' + (i === cur ? ' is-on' : '') + (i < cur ? ' is-done' : '') + '"></span>';
    }).join('');
  }

  /* ---------------- S1 差评墙 ---------------- */
  function renderReviewWall() {
    $('#review-wall').innerHTML = DATA.reviews.map(function (r) {
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
    $('#kano-legend').innerHTML = DATA.kanoLegend.map(function (k) {
      return '<span class="kano ' + k.key + '">' + k.label + '</span>';
    }).join('');
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
  function renderClock() {
    var d = new Date();
    $('#clock-dest').textContent = fTokyo.format(d);
    $('#clock-home').textContent = fBeijing.format(d);
  }

  function renderTimeline() {
    var days = DATA.trip.days;
    $('#trip-meta').textContent = DATA.trip.title + ' · ' + DATA.trip.range;
    $('#day-tabs').innerHTML = days.map(function (d) {
      return '<button class="day-tab' + (d.day === activeDay ? ' is-active' : '') + '" data-day="' + d.day + '">' +
        '<b>D' + d.day + '</b>' +
        '<span class="day-label">' + d.label + '</span>' +
        '<span class="day-note">' + d.note + '</span>' +
      '</button>';
    }).join('');
    $('#day-panel').innerHTML = days[activeDay - 1].events.map(eventCard).join('');
  }
  function eventCard(e) {
    var home = toHome(e.local);
    var tagCls = e.isNew ? 'chip-ai' : 'chip-tag';
    var okText = e.verified ? '✓ 已确认' : '⏳ 待确认';
    var okCls = e.verified ? 'chip-ok' : 'chip-pending';
    return '<article class="evt' + (e.isNew ? ' is-new' : '') + '">' +
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
        '</div>' +
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
      DATA.trip.days[p.day - 1].events.push(Object.assign({ isNew: true }, p));
    });
    // 按时间排序，让 AI 条目落入正确的时间位
    DATA.trip.days.forEach(function (d) {
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
      DATA.trip.days.forEach(function (d) {
        d.events = d.events.filter(function (e) { return !e.isNew; });
      });
      state.aiMerged = false;
    }
    state.recorded = false;
    DATA.mileage.lost.recorded = false;
    activeDay = 1;
    renderTimeline();
    renderAIStatic();
    renderMileage();
    goTo(0);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    fillTokens();

    // 必须在 fillTokens 之后获取，否则拿到的可能是被替换掉的旧节点
    screens = $$('.screen');
    titles = screens.map(function (s) { return s.getAttribute('data-title'); });

    renderReviewWall();
    renderTzSelector();
    renderTimeline();
    renderClock();
    setInterval(renderClock, 1000);
    renderAIStatic();
    renderMileage();
    renderPricingShare();

    // 走查导航
    $('#btn-next').addEventListener('click', function () { goTo(cur + 1); });
    $('#btn-prev').addEventListener('click', function () { goTo(cur - 1); });
    $('#btn-restart').addEventListener('click', restart);
    $('#btn-finish').addEventListener('click', restart);
    $$('[data-next]').forEach(function (b) {
      b.addEventListener('click', function () { goTo(cur + 1); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') goTo(cur + 1);
      if (e.key === 'ArrowLeft') goTo(cur - 1);
    });

    // S3 日签切换
    $('#day-tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.day-tab');
      if (!t) return;
      activeDay = parseInt(t.getAttribute('data-day'), 10);
      renderTimeline();
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

    goTo(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
