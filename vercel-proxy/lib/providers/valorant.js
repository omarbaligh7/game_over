/* ============================================
   GAME OVER — VALORANT Provider (HenrikDev API)
   ------------------------------------------------
   المصدر: HenrikDev Unofficial Valorant API
     - الـ Base URL: https://api.henrikdev.xyz
     - التوثيق: الـ API Key في الـ Header باسم Authorization
     - الحساب (v2): /valorant/v2/account/{name}/{tag}?force=true
         → data.account_level (مستوى الحساب — البارامتر الرسمي force=true
           موثّق كـ "Bypass cache and refresh" وبيروّح لـ Riot من غير كاش)
         → data.card (GUID بيتم تحويله لصورة الـ Card)
         → data.region (مهم للـ mmr endpoint)
     - الرانك (v3): /valorant/v3/mmr/{region}/{platform}/{name}/{tag}
         → data.current.tier.name (اسم الرانك)
         → data.current.rr (الـ RR الحالي)
         → data.current.elo
     - Fallback للمستوى (v3): /valorant/v3/matches/{region}/{name}/{tag}?size=1
         لو account_level مفقود — ناخد `level` اللاعب من بيانات آخر مباراة
         (data[0].players.all_players[].level).
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
// آخر مباراة (v3/matches) — Fallback لمستوى اللاعب
// ============================================
// بنستخدمها بس لو الـ account_level مفقود من الـ v2/account. آخر مباراة
// بتيجي جواها `level` لكل لاعب (data[0].players.all_players[].level).
// ملاحظة: مستوى المباراة = مستوى اللاعب بداية المباراة، فمش دايماً
// أسرع مصدر بعد ليفل أب — المصدر الأساسي هو v2/account?force=true.
async function fetchLatestMatch(apiKey, region, name, tag) {
  const url = `${BASE_URL}/v3/matches/${encodeURIComponent(region)}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=1`;
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
// مع force:true بنستخدم البارامتر الرسمي ?force=true اللي موثّق في توثيق
// HenrikDev كـ "Bypass cache and refresh" — بيجبرهم يروحوا لـ Riot من غير كاش.
async function fetchAccount(apiKey, name, tag, force) {
  const cb = force ? "?force=true" : "";
  const url = `${BASE_URL}/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}${cb}`;
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

  // 1) الحساب (v2/account): بناخد منه الـ region + الـ Card + الاسم +
  //    account_level. مع force:true بنبعت البارامتر الرسمي ?force=true
  //    (موثّق كـ "Bypass cache and refresh") — وده المصدر الأساسي للمستوى.
  const account = await fetchAccount(apiKey, name, tag, force);
  const region = account.region;
  const accName = account.name || name;
  const accTag = account.tag || tag;

  // 2) مستوى الحساب = account_level من الـ account (فريش مع force).
  //    لو مفقود (نادر) → نستخرجه من بيانات آخر مباراة كـ fallback.
  let latestMatch = null;
  let level = account.account_level ?? null;
  if (level == null && region) {
    latestMatch = await Promise.race([
      fetchLatestMatch(apiKey, region, accName, accTag),
      delay(3000),
    ]);
    level = levelFromMatch(latestMatch, accName, accTag) ?? null;
  }

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
