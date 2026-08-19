/* =========================================================
 * Gooh旅记 · 实时查询配置（js/config.js）
 *
 * API_BASE 已指向 Vercel 部署地址，实时查询已启用。
 * 留空 / 仍含「你的」占位 = 不启用实时查询，自动回退本地演示数据（双模式）。
 * API key 放在 Vercel 环境变量里（OPEN_TRIP_MAP_KEY / OPEN_WEATHER_MAP_KEY），
 * 绝不要写进前端文件。
 * ========================================================= */
window.CONFIG = {
  API_BASE: 'https://gooh-lvji-demo.vercel.app',
};
