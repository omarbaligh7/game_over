/* ============================================
   GAME OVER — Tracker.gg Provider: Rocket League
   ------------------------------------------------
   ⚠️ ملاحظة مهمة: Rocket League مفيهوش "Level" كلاسيكي زي Apex —
   المقياس الأساسي عندها هو "الرانك" (Rank) لكل playlist (1v1, 2v2, 3v3).
   الكود ده بيرجع أعلى رانك لقيه في الـ overview كـ "rank"، ويرجع "level"
   لو Tracker.gg وفّره ضمن الـ stats (مش مضمون لكل الحسابات).

   لو شكل الاستجابة عندك مختلف عن اللي متوقّعينه هنا، افتح رابط الـ API
   يدوياً (Postman أو المتصفح مع الهيدر) وشوف أسماء الحقول الفعلية،
   وعدّل الأسطر اللي فيها stats.xxx تحت.
   ============================================ */

const BASE_URL = "https://public-api.tracker.gg/v2/rocket-league/standard/profile";

// Rocket League معندوش Origin كمنصة — بس عندنا نفس الـ select في الفرونت إند،
// فلو حد اختار origin/epic هيتوجّه لـ epic تلقائياً.
const PLATFORM_MAP = {
  steam: "steam",
  psn: "psn",
  xbl: "xbl",
  epic: "epic",
  origin: "epic",
};

async function fetchRocketLeagueProfile(platform, trackerId, apiKey) {
  const trnPlatform = PLATFORM_MAP[platform];
  if (!trnPlatform) {
    const err = new Error(`منصة غير مدعومة لـ Rocket League: ${platform}`);
    err.statusCode = 400;
    throw err;
  }
  if (!trackerId) {
    const err = new Error("لازم تبعت Tracker Identifier (اسم اللاعب)");
    err.statusCode = 400;
    throw err;
  }

  const url = `${BASE_URL}/${trnPlatform}/${encodeURIComponent(trackerId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "TRN-Api-Key": apiKey, Accept: "application/json" },
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const err = new Error(
      `Tracker.gg رفض الطلب (HTTP ${response.status}): ${bodyText.slice(0, 300)}`
    );
    err.statusCode = response.status === 404 ? 404 : 502;
    throw err;
  }

  const json = await response.json();
  const segments = json?.data?.segments || [];
  const overview = segments.find((s) => s.type === "overview") || segments[0];
  const stats = overview?.stats || {};

  // مفيش "level" رسمي في RL غالباً — بنسيب المحاولة لو موجود، وإلا بترجع null
  const level = stats.level?.value ?? stats.seasonLevel?.value ?? null;

  // بنحاول نجيب أعلى رانك من أي playlist segment (Ranked Duel 1v1 / Doubles / Standard)
  const rankedSegments = segments.filter((s) => s.type === "playlist");
  const bestRank =
    rankedSegments
      .map((s) => s.stats?.rating?.metadata?.name || s.stats?.tier?.metadata?.name)
      .find(Boolean) ||
    stats.rank?.metadata?.name ||
    null;

  return { level, rank: bestRank, raw: json };
}

module.exports = { fetchRocketLeagueProfile };
