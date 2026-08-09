/* ============================================
   GAME OVER — Apex Legends Provider (Mozambiquehe.re / Apex Legends Status)
   ------------------------------------------------
   مصدر البيانات الوحيد: Apex Legends Status API
     GET https://api.apexlegendsstatus.com/bridge?auth=KEY&player=NAME&platform=PLATFORM

   آلية التعامل الذكية مع الحسابات الجديدة:
     1) نبعث طلب الاستعلام العادي الأول.
     2) لو نجح (200 + global.level موجود) → نرجّع البيانات للفرونت فوراً.
     3) لو فشل الطلب أو الحساب جديد (isNewToDB=true) أو رجع بيانات ناقصة:
        - نبعث Force Refresh (force=true) عشان السيرفر يجمع بيانات الحساب
          من اللعبة ويسجّله في قاعدة البيانات لأول مرة.
        - نستنى 2-3 ثواني عشان تكتمل عملية المزامنة عند السيرفر.
        - نعيد طلب الاستعلام العادي مرة تانية (Retry).
     4) لو نجح الـ retry → نرجّع البيانات. لو فشل نهائياً → خطأ واضح.

   الـ response بيرجع:
     global:  { name, tag, avatar, level, levelPrestige, rank: { rankName, rankDiv, rankScore }, ... }
     realtime: { selectedLegend, currentState, ... }
     legends: { selected: { LegendName, gameInfo, ImgAssets, ... } }
     mozambiquehere_internal: { isNewToDB, clusterSrv }
   ============================================ */

const axios = require("axios");

const BASE_URL = "https://api.apexlegendsstatus.com/bridge";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
// طلب الـ bridge (مع أو من غير force)
// ============================================
async function fetchBridge(apiKey, apiPlatform, trackerId, force = false) {
  const url = `${BASE_URL}?auth=${encodeURIComponent(apiKey)}&player=${encodeURIComponent(trackerId)}&platform=${apiPlatform}${force ? "&force=true" : ""}`;
  try {
    const response = await axios.get(url, {
      timeout: 30000,
    });
    return { ok: true, data: response.data };
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

  // ===== الخطوة 1: الطلب العادي الأول =====
  let res = await fetchBridge(apiKey, apiPlatform, trackerId);
  let parsed = res.ok ? parseBridgeData(res.data) : null;

  // لو نجح وكل البيانات الأساسية موجودة → رجّع فوراً (من غير ما نلمس السيرفر)
  if (parsed && parsed.level > 0) {
    parsed.source = "official";
    return parsed;
  }

  // ===== الخطوة 2: الحساب جديد أو ناقص → Force Refresh + انتظار + Retry =====
  // الأسباب المحتملة: 404 (غير مسجل في قاعدة بياناتهم) أو isNewToDB=true أو بيانات ناقصة.
  const firstError = res.error || (parsed?.isNewToDB ? "الحساب جديد في قاعدة البيانات" : "البيانات رجعت ناقصة");

  // جرب الـ force مرتين متتاليتين لو أول مرة سجلت الحساب بس لسه البيانات مش جاهزة
  for (let attempt = 1; attempt <= 2; attempt++) {
    const forceRes = await fetchBridge(apiKey, apiPlatform, trackerId, true);
    if (!forceRes.ok) {
      // الـ force نفسه فشل — لو 404 فاللاعب مش موجود أصلاً في اللعبة، مفيش داعي نكمل.
      if (forceRes.status === 404) break;
      continue;
    }

    // نستنى 2-3 ثواني (عشوائية) عشان السيرفر يكمل المزامنة ويسجّل الحساب
    await sleep(2000 + Math.floor(Math.random() * 1000));

    // ===== الخطوة 3: إعادة الطلب العادي (Retry) =====
    const retryRes = await fetchBridge(apiKey, apiPlatform, trackerId);
    const retryParsed = retryRes.ok ? parseBridgeData(retryRes.data) : null;
    if (retryParsed && retryParsed.level > 0) {
      retryParsed.source = "official";
      return retryParsed;
    }
  }

  // ===== الفشل الكامل =====
  const err = new Error(
    res.status === 404
      ? "اللاعب ده مش موجود على Apex Legends — تأكد من اسم اللاعب والمنصة"
      : firstError || "فشل جلب بيانات اللاعب من Apex Legends Status بعد المحاولة"
  );
  err.statusCode = res.status === 404 ? 404 : 502;
  throw err;
}

module.exports = { fetchApexProfile, parseBridgeData };
