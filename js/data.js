/* =========================================================
 * Gooh旅记 · 改进版 Demo
 * js/data.js —— 演示用假数据（走查叙事支撑）
 *
 * 时区规则：东京 = UTC+9，北京 = UTC+8，
 *           所以 北京时间 = 当地时间 − 1 小时（由 app.js 换算）。
 *
 * 本文件所有内容均为虚构演示数据，仅用于面试作品集。
 * ========================================================= */
window.DATA = {
  product: {
    name: 'Gooh旅记',
    tagline: '懒人攻略生成器',
    sub: '输入目的地、预算、时间，剩下交给 Agent。',
    reviewCount: '3,200',
    painCount: '5',
    fixCount: '3',
  },

  /* ---------- 时区相关 ---------- */
  time: {
    home: { name: '北京', tz: 'UTC+8', offset: 8 },
    dest: { name: '东京', tz: 'UTC+9', offset: 9 },
  },

  /* S2 时区识别：切换目的地演示「时区安全」 */
  tzCities: [
    { name: '东京', tz: 'UTC+9', diff: '+1 小时', sun: { rise: '04:58', set: '18:52' } },
    { name: '大阪', tz: 'UTC+9', diff: '+1 小时', sun: { rise: '05:04', set: '18:48' } },
    { name: '香港', tz: 'UTC+8', diff: '0',       sun: { rise: '05:58', set: '18:52' } },
    { name: '新加坡', tz: 'UTC+8', diff: '0',     sun: { rise: '07:02', set: '19:12' } },
    { name: '伦敦', tz: 'UTC+1', diff: '-7 小时', sun: { rise: '05:48', set: '20:18' } },
  ],

  /* S1 热门目的地（点击快速填入） */
  hotDests: ['东京', '大阪', '香港', '新加坡', '首尔', '曼谷'],

  /* ---------- S1 差评墙（KANO 归类后的「证据墙」） ---------- */
  reviews: [
    { star: 1, type: '时区', kano: '必备属性', kanoClass: 'k-must',   user: '夜航星', text: '行程表时间全乱了。回国一倒时差，发现整个计划全部错位，连酒店 check-in 都差点错过。' },
    { star: 1, type: 'AI',   kano: '无差异→魅力', kanoClass: 'k-attract', user: '带妈旅行', text: 'AI 生成的行程全是小红书上抄的，一点都不懂我妈一天走不动 2 小时。' },
    { star: 2, type: '付费', kano: '反向属性', kanoClass: 'k-reverse', user: '省钱星人', text: '连里程统计都要付费解锁？我用你是图清净，不是想被你割。' },
    { star: 2, type: '交通', kano: '期望属性', kanoClass: 'k-perf',   user: '地铁通', text: '东京查不到地铁，只有公交和走路。那我用它干嘛？' },
    { star: 2, type: '数据', kano: '期望属性', kanoClass: 'k-perf',   user: '数字控', text: '明明走了 5 公里，只给我算 2.8。数据全是假的，我凭什么信你？' },
  ],
  kanoLegend: [
    { key: 'k-must',    label: '必备属性 · 不做就死' },
    { key: 'k-perf',    label: '期望属性 · 做了加分' },
    { key: 'k-attract', label: '无差异→魅力 · 重做成惊喜' },
    { key: 'k-reverse', label: '反向属性 · 重新设计' },
  ],

  /* ---------- S3 时间轴：东京 5 日 ---------- */
  trip: {
    title: '东京 5 日 · 慢旅行',
    dest: '东京',
    tz: 'UTC+9',
    homeTz: 'UTC+8',
    range: '2026.08.20 — 08.24',
    days: [
      {
        day: 1, label: '落地 · 浅草', note: '轻行程 · 缓冲时差',
        tzNote: '落地日 · 时差已自动缓冲，第一晚只排轻行程',
        events: [
          { local: '10:15', title: '航班落地', place: '羽田机场 HND', transit: '京急线 → 浅草', tag: '交通', verified: true,
            metro: { line: '京急线', first: '05:12', last: '23:56' },
            note: '京急线直达浅草约 45 分钟，比打车省约 ¥6,000。' },
          { local: '13:30', title: '抵达酒店 · check-in', place: '浅草雷门 · 寺田屋', transit: '浅草线', tag: '住宿', verified: true,
            note: '选在浅草雷门旁，接下来两天去景点几乎全程步行。' },
          { local: '15:00', title: '浅草寺 · 仲见世商店街', place: '浅草', transit: '步行 8 分钟', tag: '景点', verified: true,
            note: '仲见世商店街傍晚 6 点起陆续打烊，先逛浅草寺再回来逛店。' },
          { local: '17:30', title: '晚餐 · 天妇罗老铺', place: '雷门附近', transit: '步行', tag: '美食', verified: true,
            note: '老铺晚间常排队，5 点前到店基本不用等位。' },
          { local: '19:30', title: '隅田川夜景散步', place: '隅田川步道', transit: '步行', tag: '夜景', verified: true,
            note: '晴空塔亮灯到 23:00，沿河散步是最佳观景位。' },
        ],
      },
      {
        day: 2, label: '明治 · 涩谷', note: '步行日 · 步数预警',
        events: [
          { local: '09:00', title: '出发 · 前往明治神宫', place: '浅草 → 明治神宫', transit: '浅草线 → 山手线', tag: '交通', verified: true,
            metro: { line: '浅草线 → 山手线', first: '05:00', last: '00:30', transfer: '上野换乘' },
            note: '上野站换乘山手线，全程约 35 分钟；首班 5:00，末班 00:30。' },
          { local: '10:00', title: '明治神宫', place: '原宿', transit: '山手线', tag: '景点', verified: true,
            note: '神宫 9 点前人流最少，主殿 10 点常有婚礼，可顺路看。' },
          { local: '12:00', title: '午餐 · 原宿', place: '表参道一带', transit: '步行', tag: '美食', verified: true,
            note: '表参道网红店 12:30 前到店基本免排队。' },
          { local: '14:00', title: '涩谷十字路口', place: '涩谷', transit: '山手线', tag: '景点', verified: true,
            note: '星巴克二楼靠窗位是拍十字路口的经典机位，早点去占座。' },
          { local: '16:00', title: '代官山 · 咖啡', place: '代官山', transit: '东急东横线', tag: '休憩', verified: true,
            note: '代官山适合慢逛，给妈妈安排在这里坐下歇脚。' },
          { local: '18:30', title: '晚餐 · 涩谷', place: '涩谷站前', transit: '步行', tag: '美食', verified: true,
            note: '涩谷站前拉面馆营业到凌晨，逛完夜景再来也来得及。' },
        ],
      },
      {
        day: 3, label: '横滨一日', note: '跨城 · 换乘提示',
        events: [
          { local: '09:00', title: '出发 · 前往横滨', place: '东京 → 横滨', transit: 'JR 东海道线', tag: '交通', verified: true,
            metro: { line: 'JR 东海道线', first: '04:52', last: '23:58' },
            note: '东海道线约 30 分钟到横滨，出站即是未来港。' },
          { local: '09:45', title: '未来港 · 红砖仓库', place: '横滨', transit: '步行', tag: '景点', verified: true,
            note: '红砖仓库周末有市集，上午人少好拍照。' },
          { local: '12:00', title: '午餐 · 中华街', place: '横滨中华街', transit: 'JR 根岸线', tag: '美食', verified: true,
            note: '中华街 12 点后人挤人，建议 11:45 前落座。' },
          { local: '14:30', title: '三溪园', place: '本牧', transit: '巴士 20 分', tag: '景点', verified: true,
            note: '园内坡道较多，带长辈建议走主路，省体力。' },
          { local: '17:00', title: '返回东京', place: '横滨 → 东京', transit: 'JR 东海道线', tag: '交通', verified: true,
            metro: { line: 'JR 东海道线', first: '04:52', last: '23:58' },
            note: '晚高峰东海道线较挤，避开 18 点返程更舒服。' },
          { local: '18:30', title: '晚餐 · 银座', place: '银座', transit: '银座线', tag: '美食', verified: true,
            note: '银座高性价比定食多，晚餐后还能看霓虹夜景。' },
        ],
      },
      {
        day: 4, label: '秋叶原 · 台场', note: '电玩与海景',
        events: [
          { local: '09:30', title: '秋叶原', place: '秋叶原', transit: '山手线', tag: '景点', verified: true,
            note: '秋叶原店铺 10 点陆续开门，先逛电器街主路。' },
          { local: '12:00', title: '上野公园 + 午餐', place: '上野', transit: '银座线', tag: '景点', verified: true,
            note: '上野公园樱花季外人也多，但树荫下很凉快，适合长辈。' },
          { local: '14:30', title: '阿美横町', place: '上野', transit: '步行', tag: '美食', verified: true,
            note: '阿美横町的便宜小吃适合边走边吃。' },
          { local: '17:00', title: '台场海滨公园', place: '台场', transit: '海鸥线', tag: '景点', verified: true,
            metro: { line: '海鸥线', first: '05:20', last: '23:40' },
            note: '海鸥线无人驾驶，坐车头能看彩虹大桥，观景位提前占。' },
          { local: '19:00', title: '晚餐 · 台场夜景', place: '台场', transit: '步行', tag: '夜景', verified: true,
            note: '台场海边餐厅看夜景，21 点前离场赶上末班海鸥线。' },
        ],
      },
      {
        day: 5, label: '返程日', note: '机场衔接',
        tzNote: '返程日 · 已预留机场衔接时间',
        events: [
          { local: '09:00', title: '退房', place: '浅草 · 寺田屋', transit: '-', tag: '住宿', verified: true,
            note: '行李可寄存前台，轻装去筑地。' },
          { local: '09:30', title: '筑地市场 · 早餐', place: '筑地', transit: '浅草线 → 日比谷线', tag: '美食', verified: true,
            metro: { line: '浅草线 → 日比谷线', first: '05:00', last: '23:58', transfer: '人形町换乘' },
            note: '筑地场外市场 9 点后人潮渐多，早起能吃到刚开铺的玉子烧。' },
          { local: '11:00', title: '前往羽田机场', place: '筑地 → 羽田', transit: '浅草线', tag: '交通', verified: true,
            metro: { line: '浅草线', first: '05:00', last: '00:10' },
            note: '浅草线直达羽田约 40 分钟；留 2 小时值机富余，不慌。' },
          { local: '13:00', title: '机场值机', place: '羽田机场 HND', transit: '-', tag: '交通', verified: true,
            note: '国际航班建议起飞前 3 小时到，羽田安检高峰在 11–13 点。' },
          { local: '15:30', title: '航班起飞', place: '羽田机场 HND', transit: '-', tag: '交通', verified: true },
        ],
      },
    ],
  },

  /* ---------- S4 AI 行程快进 ---------- */
  ai: {
    source: '粘贴自「爸妈旅游群」微信群',
    messy: '我周六早上到的东京 住浅草 帮我订个塔顶酒吧 晚上看夜景 然后周日一早去新宿御苑 中午吃一兰拉面 下午想去三鹰吉卜力美术馆 记得买票 周一晚上航班回 对了要全程地铁 我妈腿不好',
    constraints: '约束识别：全程地铁 · 每天步行 ≤ 2km · 周日晚餐前回市区',
    steps: [
      { label: '识别实体', detail: '目的地 · 日期 · 景点 · 交通偏好' },
      { label: '清洗噪音', detail: '去掉口语 · 补全语义 · 去重' },
      { label: '排入时间轴', detail: '按偏好分配到对应日期 · 标记待确认' },
    ],
    parsed: [
      { day: 1, local: '21:00', title: '晴空塔塔顶酒吧 · 夜景', place: '东京晴空塔', transit: '浅草线 1 站', tag: 'AI 新增', verified: false,
        note: '看完夜景坐浅草线 1 站回酒店，不赶末班车。' },
      { day: 2, local: '09:30', title: '新宿御苑', place: '新宿御苑', transit: '山手线 → 新宿', tag: 'AI 新增', verified: false,
        note: '周三人少、坡道平缓，适合腿不好的妈妈慢慢逛。' },
      { day: 2, local: '12:00', title: '一兰拉面 · 新宿店', place: '新宿', transit: '步行', tag: 'AI 新增', verified: false,
        note: '中午 12 点前到基本不排队。' },
      { day: 2, local: '15:00', title: '三鹰之森吉卜力美术馆', place: '三鹰', transit: 'JR 中央线', tag: 'AI 新增', verified: false,
        note: '需提前在罗森买票，别现场扑空。' },
    ],
    philosophy: [
      { t: 'AI 只做脏活', d: '结构化、清洗、排期 —— 不替你决定去哪、玩什么。' },
      { t: '约束优先', d: '把「带爸妈 / 全程地铁 / 少走路」写进约束，而不是让 AI 自由发挥。' },
      { t: '结果可改', d: '所有 AI 排入的条目都带「待确认」标记，一键可删可改。' },
    ],
  },

  /* ---------- S5 里程可信 ---------- */
  mileage: {
    trustBefore: '86%',
    trustAfter: '94%',
    days: [
      { day: 1, km: '8.2', tag: '实测' },
      { day: 2, km: '6.4', tag: '实测' },
      { day: 3, km: '11.0', tag: '实测' },
      { day: 4, km: '7.6', tag: '实测' },
      { day: 5, km: '3.2', tag: '实测' },
    ],
    lost: {
      day: 2, start: '14:00', end: '16:00', place: '涩谷段', km: 3.1,
      reason: '手机省电模式在后台静默关闭了定位',
      recorded: false,
    },
    totalReal: '36.4',
    totalAfter: '39.5',
  },

  /* ---------- S6 分享 + 定价 ---------- */
  share: {
    title: '东京 5 日 · 慢旅行',
    range: '2026.08.20 — 08.24',
    tz: 'UTC+9 / UTC+8',
    items: '26 项行程 · 双时钟校时',
    verified: '可信度 94%',
  },
  pricing: {
    price: '¥18 / 月',
    free: [
      '双时钟时间轴（核心 · 永免费）',
      '时区安全提醒 / 跨时区衔接',
      '基础行程规划 + 手动补录',
      '里程统计（实测 / 估算标签）',
    ],
    pro: [
      '高级 AI 快进（复杂约束求解）',
      '行程卡高清导出 / 无广告',
      '地铁 · 新干线等全交通模式',
      '多城市数据 · 实时更行',
    ],
    why: [
      { t: '核心永远免费', d: '时区和数据是信任的基础。信任就是产品本身，收费等于自断根基。' },
      { t: '只在增值上收费', d: '只在「帮你省时间」和「分享给家人」这类额外价值上收费。' },
      { t: '透明可解释', d: '价格与权益一页说清，不搞「先用后坑」的套路。' },
    ],
  },
};
