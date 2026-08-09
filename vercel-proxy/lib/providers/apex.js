/* ============================================
   GAME OVER — Apex Legends Provider: apexlegendsstatus.com
   ------------------------------------------------
   بديل Tracker.gg لـ Apex Legends (مفتاح Tracker لسه تحت المراجعة).
   المصدر: https://apexlegendsstatus.com/ (Unofficial API)
   الـ endpoint: GET https://api.apexlegendsstatus.com/bridge
   ============================================ */

const axios = require("axios");

const BASE_URL = "https://api.apexlegendsstatus.com/bridge";

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

  const url = `${BASE_URL}?player=${encodeURIComponent(trackerId)}&platform=${apiPlatform}`;
  let response;
  try {
    // ملحوظة: منفضلش نحدد Accept برضه "application/json" — الـ server
    // بيرفضها بـ 406 لو محددة لوحدها، بينما الافتراضي بتاع axios شغال.
    response = await axios.get(url, {
      headers: { Authorization: apiKey },
      timeout: 15000,
    });
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : "";
    if (status) {
      const newErr = new Error(
        `apexlegendsstatus.com رفض الطلب (HTTP ${status}): ${body}`
      );
      newErr.statusCode = status === 404 ? 404 : 502;
      throw newErr;
    }
    throw err;
  }

  const json = response.data;
  const global = json?.global;

  if (!global) {
    const err = new Error("الـ API رجّع رد من غير بيانات global");
    err.statusCode = 502;
    throw err;
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
