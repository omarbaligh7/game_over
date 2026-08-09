/* ============================================
   GAME OVER — Apex Legends Provider (Mozambiquehe.re / Apex Legends Status)
   ------------------------------------------------
   مصدر البيانات الوحيد: Apex Legends Status API
     GET https://api.apexlegendsstatus.com/bridge?auth=KEY&player=NAME&platform=PLATFORM

   آلية التعامل مع الحسابات الجديدة (غير المسجلة في قاعدة البيانات):
     1) نبعث طلب الاستعلام العادي الأول.
     2) لو نجح ورجعت بيانات global → نرجّع النتيجة فوراً (200 OK).
     3) لو الحساب غير موجود أو رجع "Player not found" / Missing Global Data:
        - نطلق طلب الفهرسة (Trigger) في الخلفية لمرة واحدة:
            * نفتح الرئيسية ناخد كوكيز الجلسة (ssid).
            * نفتح صفحة البروفايل بنفس الجلسة + headers متصفح كاملة.
            * ندخل /core/interface-v2 (نفس ما يفعله متصفح المستخدم بالظبط)
              — ده اللي بيفعّل فهرسة الحساب من سيرفرات EA.
        - من غير ما نستنى أي Retry Loop طويلة (مشكلة Vercel Timeout):
            * نرجّع فوراً استجابة 202:
              { "indexing": true, "message": "Player is being indexed. Please poll again in 5 seconds." }
        - الـ Frontend هو اللي بيعمل Polling (كل 5 ثواني، حتى 4 محاولات)
          لحد ما الـ API يرجع 200 بالبيانات.

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
const SITE_URL = "https://apexlegendsstatus.com";

// هيدر يحاكي متصفح Chrome حقيقي — الموقع يرفض/يتجاهل الفهرسة من الطلبات
// غير المصحوبة بهوية متصفح، والـ API force=true لا يعمل للطلبات المجانية.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// نفس الـ headers اللي بيبعتها متصفح حقيقي عند فتح الصفحة — لازمها عشان
// Cloudflare/السيرفر يقبل الفهرسة (طلبات الآلي العارية بتتجاهل الفهرسة).
const BROWSER_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Cache-Control": "max-age=0",
};

// دالة مساعدة للانتظار (async delay)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
// طلب الـ bridge (مع أو من غير force)
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

// ============================================
// محاكاة زيارة صفحة البروفايل على الموقع الأساسي
// ============================================
// سيرفر ALS يرفض فهرسة الحسابات الجديدة عبر API force=true للطلبات المجانية
// ويشترط زيارة صفحة البروفايل من واجهة الموقع (بعرض متصفح) ليفهرس الحساب
// من سيرفرات EA. لاحظنا إن مجرد GET عاري (UA فقط) لا يفعّل الفهرسة — لازم
// نعمل زيارة بنفس طريقة المتصفح الحقيقي:
//   1) نفتح الصفحة الرئيسية الأول عشان ناخد كوكيز الجلسة (ssid).
//   2) نفتح صفحة البروفايل بنفس الجلسة + headers متصفح كاملة + Referer.
// زيارة صفحة البروفايل بتخلي السيرفر يبدأ الفهرسة فوراً ("Loading profile...")
// والبيانات بتظهر خلال 5-10 ثواني.
async function getSessionCookies() {
  const homeRes = await axios.get(`${SITE_URL}/`, {
    timeout: 30000,
    maxRedirects: 5,
    headers: BROWSER_HEADERS,
  });
  const setCookie = homeRes.headers["set-cookie"];
  if (!setCookie || !Array.isArray(setCookie)) return "";
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function requestProfilePage(apiPlatform, trackerId) {
  try {
    const cookies = await getSessionCookies();
    const baseHeaders = {
      ...BROWSER_HEADERS,
      ...(cookies ? { Cookie: cookies } : {}),
    };

    // 1) نفتح صفحة البروفايل الأول (بيرجع قالب "Loading profile...")
    await axios.get(
      `${SITE_URL}/profile/${encodeURIComponent(apiPlatform)}/${encodeURIComponent(trackerId)}`,
      {
        timeout: 30000,
        maxRedirects: 5,
        headers: { ...baseHeaders, Referer: `${SITE_URL}/` },
      }
    );

    // 2) ندخل `/core/interface-v2` بنفس طريقة المتصفح — ده الـ request الحقيقي
    //    اللي بيفعّل الفهرسة وبيجيب البيانات (الـ profile_v2.js بيعمله تلقائياً).
    //    من غيره الفهرسة مش بتكتمل. بياخد 5-10 ثواني للحسابات الجديدة.
    await axios.get(
      `${SITE_URL}/core/interface-v2?token=${encodeURIComponent("CSRF_PRE_PROD")}&platform=${encodeURIComponent(apiPlatform)}&player=${encodeURIComponent(trackerId)}`,
      {
        timeout: 60000,
        maxRedirects: 5,
        headers: {
          ...baseHeaders,
          Referer: `${SITE_URL}/profile/${encodeURIComponent(apiPlatform)}/${encodeURIComponent(trackerId)}`,
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
        },
      }
    );
  } catch (err) {
    // لو فشل أي خطوة (مثلاً 403/CF) بنكمّل على الـ retry loop —
    // الفهرسة ممكن تكون اشتغلت أو لأ، ومش هنقف عشان ده.
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

  // ===== الخطوة 1: الطلب العادي الأول =====
  const firstRes = await fetchBridge(apiKey, apiPlatform, trackerId);
  const firstParsed = firstRes.ok ? parseBridgeData(firstRes.data) : null;

  // لو البيانات موجودة → رجّع فوراً (200 OK) من غير ما نلمس السيرفر
  if (hasProfile(firstParsed)) {
    firstParsed.source = "official";
    return firstParsed;
  }

  // ملاحظة: الـ bridge بيرجع 404 حتى للاعبين الموجودين في اللعبة لكن لسه
  // مش مسجلين في قاعدة بيانات الموقع (الـ body بيدّي 404 فارغ). فمينفعش
  // نستنتج "اللاعب غير موجود" من 404 قبل ما نطلق الفهرسة.

  // ===== الخطوة 2: حساب جديد/غير مسجل → إطلاق الفهرسة في الخلفية =====
  // بنعمل نفس اللي بيعمله المتصفح: الرئيسية (كوكيز) → صفحة البروفايل →
  // /core/interface-v2 (بيفعّل فهرسة الحساب من EA). من غير Retry Loop.
  // بنستنى لحد 3 ثواني كحد أقصى عشان الطلب يتنقل، وبعدين نرجّع 202 فوراً
  // والـ Frontend هو اللي بيكمّل الـ Polling.
  await Promise.race([
    requestProfilePage(apiPlatform, trackerId),
    delay(3000),
  ]);

  // ===== الخطوة 3: الـ Frontend بيتصل تاني كل 5 ثواني (Polling) =====
  // كل استعلام جديد بيحاول bridge الأول:
  //   - لو رجع 200 بالبيانات → نرجّعها فوراً.
  //   - لو لسه 404 → نطلق الـ trigger تاني (سريع) ونرجع 202.
  const indexingErr = new Error("Player is being indexed. Please poll again in 5 seconds.");
  indexingErr.statusCode = 202;
  indexingErr.code = INDEXING;
  indexingErr.indexing = true;
  throw indexingErr;
}

module.exports = { fetchApexProfile, parseBridgeData, requestProfilePage, getSessionCookies, delay, INDEXING };
