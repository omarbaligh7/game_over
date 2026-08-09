/* ============================================
   GAME OVER — Tracker.gg Provider: Rocket League
   ------------------------------------------------
   ⚠️ ملاحظة مهمة: Rocket League مفيهوش "Level" كلاسيكي زي Apex —
   المقياس الأساسي عندها هو "الرانك" (Rank) لكل playlist (1v1, 2v2, 3v3).

   خطة التشغيل (Fallback):
   1) نحاول الأول بالـ Official API (اللي محتاج TRN_API_KEY).
   2) لو رجّع 401/403/500 أو فشل (المفتاح لسه تحت المراجعة)،
      بنقع أوتوماتيكياً على الـ Scraping Fallback (lib/scraper)
      عشان الموقع يفضل شغال.
   ============================================ */

const { fetchRocketLeagueScraped } = require("../scraper/rocket-league");

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

  try {
    const official = await fetchOfficial(trnPlatform, trackerId, apiKey);
    return official;
  } catch (err) {
    // لو المشكلة من الـ API Key (401/403/500) أو من الشبكة → ننزل للـ fallback
    if (
      err.statusCode === 401 ||
      err.statusCode === 403 ||
      err.statusCode === 500 ||
      err.statusCode === 502
    ) {
      const scraped = await fetchRocketLeagueScraped(trnPlatform, trackerId);
      return {
        ...scraped,
        source: "scrape",
        apiKeyError: err.message,
      };
    }
    throw err;
  }
}

// ===== الطريقة الأولانية: الـ Official API =====
async function fetchOfficial(trnPlatform, trackerId, apiKey) {
  if (!apiKey) {
    const err = new Error("مفيش TRN_API_KEY متحدد");
    err.statusCode = 401;
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
    err.statusCode = response.status === 404 ? 404 : response.status;
    throw err;
  }

  const json = await response.json();
  const segments = json?.data?.segments || [];
  const overview = segments.find((s) => s.type === "overview") || segments[0];
  const stats = overview?.stats || {};

  const level = stats.level?.value ?? stats.seasonLevel?.value ?? null;

  const rankedSegments = segments
    .filter((s) => s.type === "playlist" && s.stats?.rating?.value != null)
    .map((s) => ({
      playlistId: s.attributes?.playlistId,
      rank: s.stats?.tier?.metadata?.name || s.stats?.rating?.metadata?.tierName || null,
      division: s.stats?.division?.metadata?.name || null,
      mmr: s.stats?.rating?.value ?? null,
      matches: s.stats?.matchesPlayed?.value ?? null,
    }))
    .sort((a, b) => (b.mmr ?? 0) - (a.mmr ?? 0));

  // "أعلى رانك" من الـ ranked playlists (1v1/2v2/3v3) مش Casual
  const rankedIds = [10, 11, 13];
  const best = rankedSegments.find((s) => rankedIds.includes(s.playlistId)) || rankedSegments[0] || null;
  const totalMatches = rankedSegments.reduce(
    (sum, p) => sum + (Number(p.matches) || 0),
    0
  );

  return {
    level,
    rank: best ? (best.division ? `${best.rank} ${best.division}` : best.rank) : null,
    rankDetails: rankedSegments,
    mmr: best?.mmr ?? null,
    matches: totalMatches,
    source: "official",
    raw: json,
  };
}

module.exports = { fetchRocketLeagueProfile };
