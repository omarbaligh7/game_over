/* ============================================
   GAME OVER — Apex Legends Provider (Apex Legends Status)
   ------------------------------------------------
   مصدر البيانات الوحيد: Apex Legends Status API
     GET https://api.apexlegendsstatus.com/bridge?auth=KEY&player=NAME&platform=PLATFORM

   الآلية الحالية (Frontend Trigger — الالتفاف على Cloudflare):
     1) الـ Frontend هو اللي بيعمل "Trigger" للفهرسة من متصفح المستخدم
        مباشرة: بيفتح صفحة البروفايل على apexlegendsstatus.com
        (fetch no-cors / image request) عشان يسجّل الحساب الجديد على
        الموقع. السيرفر هنا مبقاش بيعمل أي Scraping/Trigger خالص.
     2) بعد ما الفرونت يطلق الـ Trigger (ويستنى 3 ثواني)، بيستعلم مننا
        عادي بـ bridge الرسمي:
          - لو رجع 200 وبيانات global كاملة → نرجّع النتيجة فوراً.
          - لو الحساب لسه غير مسجل / بيتفهرس → نرجّع 202:
            { "indexing": true, "message": "Player is being indexed. Please poll again in 5 seconds." }
     3) الفرونت بيعمل Polling (كل 5 ثواني، حتى 4 محاولات) وكل محاولة
        بيعيد إطلاق الـ Trigger من المتصفح لحد ما الـ API يرجع 200.

   ملاحظة: النطاق الرسمي الحالي هو api.apexlegendsstatus.com (النطاق القديم
   api.mozambiquehere.com لا يتحل DNS حالياً — نفس الخدمة).

   الـ response بيرجع:
     global:  { name, tag, avatar, level, levelPrestige, rank: { rankName, rankDiv, rankScore }, ... }
     realtime: { selectedLegend, currentState, ... }
     legends: { selected: { LegendName, gameInfo, ImgAssets, ... } }
     mozambiquehere_internal: { isNewToDB, clusterSrv }
   ============================================ */

const axios = require("axios");

const BASE_URL = "https://api.apexlegendsstatus.com/bridge";

// رمز خاص للدلالة على إن الحساب لسه بيتفهرَس لأول مرة (الـ Route بيحوّله لـ 202)
const INDEXING = Symbol("apex.player.indexing");

// تحويل منصات الفرونت إند لمنصات الـ API
// الـ API بيقبل: PC (Origin/Steam), PS4, X1
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
// طلب الـ bridge (الـ API الرسمي الوحيد للسيرفر)
// ============================================
async function fetchBridge(apiKey, apiPlatform, trackerId, force = false) {
  const url = `${BASE_URL}?auth=${encodeURIComponent(apiKey)}&player=${encodeURIComponent(trackerId)}&platform=${apiPlatform}${force ? "&force=true" : ""}`;
  try {
    const response = await axios.get(url, {
      timeout: 30000,
    });
    return { ok: true, data: response.data, status: response.status };
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : "";
    return { ok: false, error: `HTTP ${status}: ${body}`.trim(), status };
  }
}

// بنحول رد الـ API (global + realtime + legends) لشكل موحد نظيف
function parseBridgeData(json) {
  const g = json?.global;
  if (!g) return null;

  // المستوى: global.level + الـ prestige (الأسطوانات المسقطة بيبقى عليها ×100)
  const rawLevel = Number(g.level) || 0;
  const prestige = Number(g.levelPrestige) || 0;
  const level = prestige > 0 ? prestige * 100 + rawLevel : rawLevel;

  // الرانك: اسم الرتبة + الـ division لو موجود (مش Unranked)
  const rankName = g.rank?.rankName || null;
  const rankDiv = Number(g.rank?.rankDiv) || 0;
  const isRanked = rankName && rankName !== "Unranked";
  const rank = isRanked
    ? rankDiv > 0 && rankName !== "Apex Predator"
      ? `${rankName} ${DIVISION_NAMES[rankDiv - 1] ?? "IV"}`
      : rankName
    : null;

  // الـ Legend: الرسمي من realtime.selectedLegend أو من legends.selected
  const legend =
    json?.realtime?.selectedLegend ||
    json?.legends?.selected?.LegendName ||
    null;

  return {
    name: g.name || null,
    tag: g.tag || null,
    avatar: g.avatar || null,
    level,
    rank,
    rankScore: g.rank?.rankScore ?? null,
    rankName: rankName ?? null,
    rankDiv: rankDiv || null,
    legend,
    arenaRank: g.arena?.rankName ?? null,
    arenaRankScore: g.arena?.rankScore ?? null,
    isNewToDB: json?.mozambiquehere_internal?.isNewToDB ?? false,
    raw: json,
  };
}

// بترجّع true لو الرد ده فيه حساب حقيقي (بيانات global كاملة بالمستوى)
function hasProfile(parsed) {
  return !!parsed && parsed.level > 0;
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

  // ===== الطلب الوحيد: الـ API الرسمي (bridge) =====
  // مفيش أي Scraping/Trigger هنا خالص — ده الشغل بتاع الفرونت إند
  // (بيطلق فهرسة الحساب من متصفح المستخدم مباشرة عشان Cloudflare).
  const firstRes = await fetchBridge(apiKey, apiPlatform, trackerId);
  const firstParsed = firstRes.ok ? parseBridgeData(firstRes.data) : null;

  // لو البيانات موجودة → رجّع فوراً (200 OK)
  if (hasProfile(firstParsed)) {
    firstParsed.source = "official";
    return firstParsed;
  }

  // لسه غير مسجل/بيتفهرس → رجّع 202 والفرونت هو اللي بيكمّل:
  // (بيرجع يفتح صفحة البروفايل من المتصفح + Polling كل 5 ثواني).
  const indexingErr = new Error("Player is being indexed. Please poll again in 5 seconds.");
  indexingErr.statusCode = 202;
  indexingErr.code = INDEXING;
  indexingErr.indexing = true;
  throw indexingErr;
}

module.exports = { fetchApexProfile, parseBridgeData, INDEXING };
