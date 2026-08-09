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
// آخر مباراة (v3/matches) — مصدر الـ account_level الفريش
// ============================================
// اكتشفنا إن HenrikDev بيدي account_level من كاش ثقيل على v2/account
// (x-cache-ttl ~40 دقيقة) والكاش ده بيتجاهل الـ query params (حتى لو
// ضفنا t= أي قيمة بيرجع HIT). والأسوأ: الـ v1/v2/v3 mmr مش بترجع
// account_level خالص.
//
// الحل: آخر مباراة من v3/matches بتيجي جواها `level` لكل لاعب من بيانات
// المباراة نفسها (لحد اللعب الأخير) — دي أسرع مصدر متاح. بنطلب المباراة
// (اللي بتجبر HenrikDev يكلم Riot) ومنها ناخد مستوى اللاعب مباشرة.
// مع force:true بنضيف t=timestamp عشان نحاول نقلل التخزين المؤقت (best effort).
async function fetchLatestMatch(apiKey, region, name, tag, force) {
  const cb = force ? `&t=${Date.now()}` : "";
  const url = `${BASE_URL}/v3/matches/${encodeURIComponent(region)}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=1${cb}`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: apiKey },
      timeout: 20000,
    });
    return response.data?.data?.[0] || null;
  } catch (err) {
    // 404 = مفيش مباريات/منطقة غلط، 429 = rate limit... كلها مش قاتلة.
    console.warn("Valorant matches fetch failed:", err.response?.status || err.message);
    return null;
  }
}

// نستخرج مستوى اللاعب من بيانات آخر مباراة (بيانات المباراة = فريش لحظي).
// بندور على اللاعب بالاسم والـ tag، ولو مش لاقيينه بناخد أول لاعب.
function levelFromMatch(match, name, tag) {
  if (!match) return null;
  const players = match.players?.all_players;
  if (!Array.isArray(players) || !players.length) return null;
  const p =
    players.find(
      (x) =>
        String(x.name).toLowerCase() === String(name).toLowerCase() &&
        String(x.tag).toLowerCase() === String(tag).toLowerCase()
    ) || players[0];
  const lvl = Number(p?.level);
  return !Number.isNaN(lvl) && lvl > 0 ? lvl : null;
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

async function fetchValorantProfile(platform, trackerId, apiKey, force) {
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

  // 1) الحساب (v2/account): بناخد منه الـ region + الـ Card + الاسم.
  //    (الـ account_level فيه كاش ثقيل ~40 دقيقة — مش مصدرنا للمستوى)
  const account = await fetchAccount(apiKey, name, tag);
  const region = account.region;
  const accName = account.name || name;
  const accTag = account.tag || tag;

  // 2) آخر مباراة (v3/matches): دي مصدر الـ account_level الفريش — مستوى
  //    اللاعب جوه بيانات المباراة (لحد آخر لعب). بنجبرها تكلم Riot،
  //    ومع force:true بنضيف t=timestamp (best effort ضد الكاش).
  //    مش هنستنى طويل: حد أقصى 3 ثواني.
  let latestMatch = null;
  if (region) {
    latestMatch = await Promise.race([
      fetchLatestMatch(apiKey, region, accName, accTag, force),
      delay(3000),
    ]);
  }

  // 3) مستوى الحساب = من آخر مباراة (فريش) ولو مفيش → الـ v2/account
  const level = levelFromMatch(latestMatch, accName, accTag) ?? account.account_level ?? null;

  // 4) الرانك: الـ v3 mmr بياخد الـ region اللي رجع من خطوة الحساب.
  //    لو فشل (اللاعب مش رانك مثلًا) نكمّل بالمستوى بس من غير ما نوقع.
  let mmr = null;
  try {
    mmr = await fetchMmr(apiKey, region, mmrPlatform, accName, accTag);
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
    name: accName,
    tag: accTag,
    level,
    rank: isRated ? currentTier : null,
    rankScore: mmr?.current?.rr ?? null,
    mmr: mmr?.current?.elo ?? null,
    peakRank: mmr?.peak?.tier?.name ?? null,
    avatar: cardImageUrl(account.card),
    source: "henrikdev",
    raw: { account, mmr, latestMatch },
  };
}

module.exports = { fetchValorantProfile, cleanTag };
