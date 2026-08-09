/* ============================================
   GAME OVER — VALORANT Provider (HenrikDev API)
   ------------------------------------------------
   المصدر: HenrikDev Unofficial Valorant API
     - الـ Base URL: https://api.henrikdev.xyz
     - التوثيق: الـ API Key في الـ Header باسم Authorization
     - الحساب (v2): /valorant/v2/account/{name}/{tag}
         → data.account_level (مستوى الحساب)
         → data.card (GUID بيتم تحويله لصورة الـ Card)
         → data.region (مهم للـ mmr endpoint)
     - الرانك (v3): /valorant/v3/mmr/{region}/{platform}/{name}/{tag}
         → data.current.tier.name (اسم الرانك)
         → data.current.rr (الـ RR الحالي)
         → data.current.elo
     - Cache Refresh Trigger (v3): /valorant/v3/matches/{region}/{name}/{tag}?size=1
         HenrikDev بيدي account_level مخزّن قديم — بنبعث طلب آخر مباراة
         (Background Trigger) عشان نجبره يكلم Riot ويحدّث الحساب، وبعدها
         نعيد جلب v2/account فبييجي account_level محدّث.
   ============================================ */

const axios = require("axios");

const BASE_URL = "https://api.henrikdev.xyz/valorant";

// GUID الـ Card اللي بيرجعه الـ API بيتحول لصورة فعلية من خدمة media.valorant-api.com
// (البنر العريض = wideart، والصورة الصغيرة = smallart)
function cardImageUrl(cardId) {
  if (!cardId) return null;
  const id = String(cardId).trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return id; // لو وصل URL جاهز خلّيه زي ما هو
  return `https://media.valorant-api.com/playercards/${id}/wideart.png`;
}

// تنظيف الـ Tag: بنشيل أي علامة "#" لو المستخدم كتبها (عشان نتجنب 401/404)
function cleanTag(tag) {
  return String(tag || "").replace(/#/g, "").trim();
}

// دالة مساعدة للانتظار (async delay)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================
// Background Trigger — تحديث كاش الحساب على HenrikDev
// ============================================
// سيرفر HenrikDev بيدي بيانات الحساب (account_level) من كاش قديم محفوظ
// عندهم، وما بيحدّثوش إلا لو طلبناهم يجيبو آخر مباراة للاعب من سيرفرات
// Riot المباشرة. فبنبعث طلب جانبي لـ:
//   GET /valorant/v3/matches/{region}/{name}/{tag}?size=1
// اللي بيجبرهم يتصلوا بـ Riot ويحدّثوا بيانات اللاعب، وبعدها الـ v2/account
// بيرجّع account_level محدّث. الـ trigger ده مش خطأ قاتل لو فشل — بنكمّل
// بآخر مستوى معروف.
async function fetchMatchesTrigger(apiKey, region, name, tag) {
  const url = `${BASE_URL}/v3/matches/${encodeURIComponent(region)}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=1`;
  try {
    await axios.get(url, {
      headers: { Authorization: apiKey },
      timeout: 20000,
    });
  } catch (err) {
    // 404 = مفيش مباريات/منطقة غلط، 429 = rate limit... كلها مش قاتلة.
    console.warn("Valorant matches trigger failed:", err.response?.status || err.message);
  }
}

// بنجيب بيانات الحساب (المستوى + الـ Card + الـ region) من الـ v2 account endpoint
async function fetchAccount(apiKey, name, tag) {
  const url = `${BASE_URL}/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: apiKey },
      timeout: 15000,
    });
    const data = response.data?.data;
    if (!data) {
      const err = new Error("الاستجابة رجعت من غير بيانات حساب");
      err.statusCode = 502;
      throw err;
    }
    return data;
  } catch (err) {
    // نطبيع خطأ axios لخطأ بنفسنا مع statusCode واضح (الـ endpoint بيقراه)
    const status = err.response?.status || err.statusCode || 502;
    const httpErr = new Error(
      status === 404
        ? "الحساب ده مش موجود على VALORANT — تأكد من الاسم والـ Tag"
        : `HenrikDev رفض طلب الحساب (HTTP ${status})`
    );
    httpErr.statusCode = status;
    throw httpErr;
  }
}

// بنجيب بيانات الرانك (الـ Rank + الـ RR) من الـ v3 mmr endpoint
// لاحظ إن الـ v3 محتاج معامل "platform" (pc/console) — ده سبب 404 لو اتساب.
async function fetchMmr(apiKey, region, platform, name, tag) {
  const url = `${BASE_URL}/v3/mmr/${encodeURIComponent(region)}/${platform}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: apiKey },
      timeout: 15000,
    });
    const data = response.data?.data;
    if (!data) {
      const err = new Error("الاستجابة رجعت من غير بيانات MMR");
      err.statusCode = 502;
      throw err;
    }
    return data;
  } catch (err) {
    const status = err.response?.status || err.statusCode || 502;
    // 404 هنا غالباً اللاعب مش عنده بيانات رانك — الـ caller بيقرر (مش خطأ قاتل)
    const httpErr = new Error(`HenrikDev رفض طلب الـ MMR (HTTP ${status})`);
    httpErr.statusCode = status;
    throw httpErr;
  }
}

async function fetchValorantProfile(platform, trackerId, apiKey) {
  // في VALORANT الـ "trackerId" هو الـ Riot ID بصيغة "Name#Tag".
  // نقدر نقسمه هنا لو جاله كده، حتى لو الـ endpoint بيبعته منفصل.
  const rawId = String(trackerId || "").trim();
  const hashIdx = rawId.indexOf("#");
  const name = (hashIdx >= 0 ? rawId.slice(0, hashIdx) : rawId).trim();
  const tag = cleanTag(hashIdx >= 0 ? rawId.slice(hashIdx + 1) : "");

  if (!name || !tag) {
    const err = new Error("لازم تبعت Riot ID بصيغة: Name#Tag (مثال: TenZ#SEN)");
    err.statusCode = 400;
    throw err;
  }
  if (!apiKey) {
    const err = new Error("مفيش VALORANT_API_KEY متحدد");
    err.statusCode = 401;
    throw err;
  }

  // منصة الـ v3 mmr: الفرونت إند بتبعت origin/psn/... لكن VALORANT هي pc/console.
  // لو المستخدم اختار PSN نعتبرها console، والباقي pc.
  const mmrPlatform = platform === "psn" || platform === "xbl" ? "console" : "pc";

  // 1) الحساب الأول: بنجيب الـ region (لازمها لطلب المباريات والـ mmr)
  const account = await fetchAccount(apiKey, name, tag);
  const region = account.region;

  // 2) Background Trigger: بنطلب آخر مباراة (size=1) عشان نجبر HenrikDev
  //    يتصل بـ Riot Games مباشرة ويحدّث كاش الحساب — فـ account_level
  //    في الرد اللي بعده يبقى محدّث (مش قديم مخزّن).
  //    مش هنستنى طويل: حد أقصى 3 ثواني للـ trigger + مهلة قصيرة للانتشار.
  await Promise.race([
    fetchMatchesTrigger(apiKey, region, account.name || name, account.tag || tag),
    delay(3000),
  ]);
  await delay(1500);

  // 3) نعيد جلب الحساب بعد الـ trigger → account_level المحدّث.
  //    لو الـ re-fetch فشل (نادر) ننزل على بيانات الخطوة الأولى.
  let freshAccount = account;
  try {
    freshAccount = await fetchAccount(apiKey, account.name || name, account.tag || tag);
  } catch (err) {
    console.warn("Valorant re-fetch after trigger failed, using first fetch:", err.message);
  }

  // 4) الرانك: الـ v3 mmr بياخد الـ region اللي رجع من خطوة الحساب.
  //    لو فشل (اللاعب مش رانك مثلًا) نكمّل بالمستوى بس من غير ما نوقع.
  let mmr = null;
  try {
    mmr = await fetchMmr(apiKey, region, mmrPlatform, freshAccount.name || name, freshAccount.tag || tag);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.status === 404) {
      // اللاعب مش عنده بيانات رانك بعد — مش خطأ، بس مفيش rank.
      mmr = null;
    } else {
      throw err;
    }
  }

  const currentTier = mmr?.current?.tier?.name;
  const isRated = currentTier && currentTier !== "Unrated";

  return {
    name: freshAccount.name || name,
    tag: freshAccount.tag || tag,
    level: freshAccount.account_level ?? null,
    rank: isRated ? currentTier : null,
    rankScore: mmr?.current?.rr ?? null,
    mmr: mmr?.current?.elo ?? null,
    peakRank: mmr?.peak?.tier?.name ?? null,
    avatar: cardImageUrl(freshAccount.card),
    source: "henrikdev",
    raw: { account: freshAccount, mmr },
  };
}

module.exports = { fetchValorantProfile, cleanTag };
