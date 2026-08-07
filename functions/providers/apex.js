/* ============================================
   GAME OVER — Tracker.gg Provider: Apex Legends
   ------------------------------------------------
   المسؤول الوحيد عن معرفة "ازاي تكلم Tracker.gg عشان تجيب بيانات
   Apex Legends". أي لعبة جديدة (Rocket League مثلاً) بتاخد ملف
   منفصل زي ده بالظبط، وبتتسجل في providers/index.js.
   ============================================ */

const BASE_URL = "https://public-api.tracker.gg/v2/apex/standard/profile";

// Tracker.gg بيستخدم أسماء منصات مختلفة عن أسماء المنصات المعروضة للمستخدم.
// المفاتيح هنا (origin, psn, xbl...) لازم تطابق قيم <select id="a-platform">
// في الفرونت إند (app.js).
const PLATFORM_MAP = {
  origin: "origin", // Origin / EA App
  psn: "psn",        // PlayStation Network
  xbl: "xbl",         // Xbox Live
  steam: "steam",     // Steam (بعض الألعاب بتدعمه، Apex معندوش دعم رسمي حالياً)
  epic: "origin",     // Apex Legends على Epic بيتحسب برضه من خلال EA/Origin ID غالباً
};

/**
 * يجيب مستوى ورانك حساب Apex Legends من Tracker.gg
 * @param {string} platform - قيمة المنصة من الفرونت إند (origin/psn/xbl/steam/epic)
 * @param {string} trackerId - اسم اللاعب (EA Name / Gamertag / PSN ID)
 * @param {string} apiKey - TRN-Api-Key
 * @returns {Promise<{level: number|null, rank: string|null, raw: object}>}
 */
async function fetchApexProfile(platform, trackerId, apiKey) {
  const trnPlatform = PLATFORM_MAP[platform];
  if (!trnPlatform) {
    const err = new Error(`منصة غير مدعومة لـ Apex Legends: ${platform}`);
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
    headers: {
      "TRN-Api-Key": apiKey,
      Accept: "application/json",
    },
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

  // Tracker.gg بيرجع الـ Level تحت مفتاح "level" غالباً، وبيرجع الرانك
  // تحت "rankScore" أو "rank" حسب نسخة الـ API — بنجرب أكتر من مفتاح
  // احتياطاً لأي اختلاف بسيط في شكل الاستجابة.
  const level =
    stats.level?.value ?? stats.playerLevel?.value ?? json?.data?.metadata?.level ?? null;
  const rank =
    stats.rank?.metadata?.name ??
    stats.rankScore?.metadata?.rankName ??
    json?.data?.metadata?.currentRankName ??
    null;

  return { level, rank, raw: json };
}

module.exports = { fetchApexProfile };
