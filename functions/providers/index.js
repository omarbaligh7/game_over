/* ============================================
   GAME OVER — Tracker.gg Providers Registry
   ------------------------------------------------
   عشان تضيف لعبة جديدة مستقبلاً (Rocket League مثلاً):
     1) اعمل ملف providers/rocket-league.js زي apex.js بالظبط
        (بنفس شكل الـ return: { level, rank, raw })
     2) استورده هنا وسجّله في PROVIDERS تحت الـ slug بتاعه
     3) في الفرونت إند (app.js) ضيف نفس الـ slug في TRACKER_GAMES
   مفيش أي تعديل تاني مطلوب — الـ endpoint العام (/getLevel) هيشتغل
   تلقائياً مع أي لعبة متسجلة هنا.
   ============================================ */

const { fetchApexProfile } = require("./apex");

const PROVIDERS = {
  apex: fetchApexProfile,
  // "rocket-league": fetchRocketLeagueProfile,  // مثال لإضافة مستقبلية
};

function getProvider(gameSlug) {
  return PROVIDERS[gameSlug] || null;
}

function supportedGames() {
  return Object.keys(PROVIDERS);
}

module.exports = { getProvider, supportedGames };
