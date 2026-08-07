/* ============================================
   GAME OVER — Tracker.gg Provider: Apex Legends
   ------------------------------------------------
   نفس منطق نسخة Firebase Functions بالظبط، منقول هنا عشان يشتغل
   على Vercel. أي لعبة جديدة بتاخد ملف منفصل زي ده بالظبط.
   ============================================ */

const BASE_URL = "https://public-api.tracker.gg/v2/apex/standard/profile";

// أسماء المنصات عند Tracker.gg — لازم تطابق قيم <select id="a-platform"> في app.js
const PLATFORM_MAP = {
  origin: "origin", // Origin / EA App
  psn: "psn",        // PlayStation Network
  xbl: "xbl",         // Xbox Live
  steam: "steam",
  epic: "origin",     // Apex على Epic بيتحسب عن طريق EA/Origin ID غالباً
};

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
