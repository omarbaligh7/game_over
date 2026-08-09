/* ============================================
   GAME OVER — Tracker.gg Providers Registry (Vercel)
   ------------------------------------------------
   عشان تضيف لعبة جديدة مستقبلاً:
     1) اعمل lib/providers/<game>.js بنفس شكل apex.js
     2) استورده هنا وسجّله تحت الـ slug بتاعه
     3) في app.js ضيف نفس الـ slug جوه TRACKER_GAMES
   ============================================ */

const { fetchApexProfile } = require("./apex");
const { fetchRocketLeagueProfile } = require("./rocket-league");
const { fetchValorantProfile } = require("./valorant");

const PROVIDERS = {
  apex: fetchApexProfile,
  "rocket-league": fetchRocketLeagueProfile,
  valorant: fetchValorantProfile,
};

function getProvider(gameSlug) {
  return PROVIDERS[gameSlug] || null;
}

function supportedGames() {
  return Object.keys(PROVIDERS);
}

module.exports = { getProvider, supportedGames };
