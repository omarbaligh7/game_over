/* ============================================
   GAME OVER — Apex Legends Provider
   ------------------------------------------------
   مصادر البيانات (بالترتيب):
   1) apexlegendsstatus.com API — المصدر الأساسي (بيانات دقيقة ومنظمة).
   2) Tracker.gg internal API (lib/scraper/apex.js) — Fallback للاعبين
      الجداد اللي لسه مش متسجلين في قاعدة بيانات apexlegendsstatus.com
      (بيترفضوا بـ 404 مهما حاولنا معاهم).
   ============================================ */

const axios = require("axios");
const { fetchApexScraped } = require("../scraper/apex");

const BASE_URL = "https://api.apexlegendsstatus.com/bridge";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// تحويل منصات الفرونت إند لمنصات الـ API
// الـ API بيقبل: PC (Origin/Steam), PS4, X1, SWITCH
const PLATFORM_MAP = {
  origin: "PC", // Origin / EA App
  steam: "PC",  // Steam (بيستخدم اسم الـ Origin المرتبط به)
  epic: "PC",   // Epic بيخش من خلال EA/Origin
  psn: "PS4",   // PlayStation Network
  xbl: "X1",    // Xbox Live
};

// تحويل رقم الـ division لاسمه — rankDiv بيساوي رقم الـ division مباشرة:
// 1=I (الأعلى), 2=II, 3=III, 4=IV (الأدنى)
const DIVISION_NAMES = ["I", "II", "III", "IV"];

// ============================================
// جلب البيانات من الـ bridge بالاسم
// ============================================
async function fetchBridge(apiKey, apiPlatform, trackerId) {
  const url = `${BASE_URL}?player=${encodeURIComponent(trackerId)}&platform=${apiPlatform}`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: apiKey },
      timeout: 15000,
    });
    return { ok: true, data: response.data };
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : "";
    return { ok: false, error: `HTTP ${status}: ${body}` };
  }
}

async function fetchApexProfile(platform, trackerId, apiKey) {
  const apiPlatform = PLATFORM_MAP[platform];
  if (!apiPlatform) {
    const err = new Error(`منصة غير مدعومة لـ Apex Legends: ${platform}`);
    err.statusCode = 400;
    throw err;
  }
  if (!trackerId) {
    const err = new Error("لازم تبعت Tracker Identifier (اسم اللاعب)");
    err.statusCode = 400;
    throw err;
  }
  if (!apiKey) {
    const err = new Error("مفيش APEX_API_KEY متحدد");
    err.statusCode = 401;
    throw err;
  }

  // ===== جلب البيانات من apexlegendsstatus.com =====
  // بجرب بالاسم مع إعادة محاولة — اللاعب الجديد بياخد شوية ثواني يتجمع.
  let json = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetchBridge(apiKey, apiPlatform, trackerId);
    if (res.ok && res.data?.global) {
      const g = res.data.global;
      const hasLevel = Number(g.level) > 0;
      const hasRank = !!g.rank?.rankName && g.rank.rankName !== "Unranked";
      if (hasLevel || hasRank || attempt === 3) {
        json = res.data;
        break;
      }
      lastError = "البيانات رجعت ناقصة (من غير level/rank)";
      await sleep(2500);
    } else {
      lastError = res.error;
      if (attempt < 3) await sleep(2500);
    }
  }

  const global = json?.global;

  // لو apexlegendsstatus رفض اللاعب (404 — غالباً لاعب جديد مش مسجل في
  // قاعدة بياناتهم) → ننزل على Tracker.gg اللي بيشتغل مع أي لاعب فوراً.
  if (!global) {
    const scraped = await fetchApexScraped(platform, trackerId);
    return {
      ...scraped,
      source: "tracker-scrape",
      apiKeyError: lastError || null,
    };
  }

  // المستوى: global.level + الـ prestige (الأسطوانات المسقطة بيبقى عليها ×100)
  const rawLevel = Number(global.level) || 0;
  const prestige = Number(global.levelPrestige) || 0;
  const level = prestige > 0 ? prestige * 100 + rawLevel : rawLevel;

  // الرانك: اسم الرتبة + الـ division لو موجود (مش Unranked)
  const rankName = global.rank?.rankName || null;
  const rankDiv = Number(global.rank?.rankDiv) || 0;
  const isRanked = rankName && rankName !== "Unranked";
  const rank = isRanked
    ? rankDiv > 0 && rankName !== "Apex Predator"
      ? `${rankName} ${DIVISION_NAMES[rankDiv - 1] ?? "IV"}`
      : rankName
    : null;

  return {
    level,
    rank,
    rankScore: global.rank?.rankScore ?? null,
    arenaRank: global.arena?.rankName ?? null,
    arenaRankScore: global.arena?.rankScore ?? null,
    raw: json,
  };
}

module.exports = { fetchApexProfile };
