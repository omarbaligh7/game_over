/* ============================================
   GAME OVER — Tracker.gg Apex Legends Fallback (خطة ب)
   ------------------------------------------------
   ليه ده موجود؟:
   - apexlegendsstatus.com API (المصدر الأساسي) بيفشل مع اللاعبين الجداد
     اللي لسه مش متسجلين في قاعدة بياناتهم — بيفضل يرجع 404 مهما حاولنا
     (nametouid، زيارة صفحة الموقع، البحث في التراكر).
   - الحل: نفس الـ internal API بتاع tracker.gg اللي شغال عندنا للـ Rocket
     League — بيشتغل مع أي لاعب من غير تسجيل مسبق، وبيقبل: psn, origin,
     steam, xbl.
   ============================================ */

const axios = require("axios");
const cheerio = require("cheerio");

// curl-cffi بيمرّر TLS fingerprint لمتصفح حقيقي (impersonate) —
// دي الطريقة الوحيدة اللي بتعدي حماية Cloudflare من Node.
let curlCffiModule = null;
function getCurlCffi() {
  if (curlCffiModule === null) {
    try {
      curlCffiModule = require("curl-cffi");
    } catch (e) {
      curlCffiModule = false;
    }
  }
  return curlCffiModule;
}

const IMPERSONATE_VALUES = ["chrome136", "chrome124", "chrome110", "chrome99", "safari17_0", "firefox133"];

async function httpGet(url, { headers, timeout = 15000 } = {}) {
  const curlCffi = getCurlCffi();
  if (curlCffi) {
    let lastErr = null;
    for (const imp of IMPERSONATE_VALUES) {
      try {
        const res = await curlCffi.req.get(url, {
          impersonate: imp,
          headers: { ...headers, Accept: headers.Accept || "application/json" },
          timeout,
        });
        if (res.status >= 200 && res.status < 300) {
          const text =
            typeof res.data === "string"
              ? res.data
              : res.data != null
              ? JSON.stringify(res.data)
              : res.text;
          if (text == null) {
            throw new Error(`curl-cffi رجّع status ${res.status} من غير body`);
          }
          return { status: res.status, data: text };
        }
        const err = new Error(`curl-cffi رجّع status ${res.status} (impersonate: ${imp})`);
        err.statusCode = res.status;
        lastErr = err;
      } catch (e) {
        lastErr = e;
        if (e.statusCode === 403 || e.statusCode === 429) continue;
        break;
      }
    }
    if (lastErr && (lastErr.statusCode === 403 || lastErr.statusCode === 429)) {
      throw lastErr;
    }
  }

  try {
    const ax = await axios.get(url, { headers, timeout });
    return {
      status: ax.status,
      data: typeof ax.data === "string" ? ax.data : JSON.stringify(ax.data),
    };
  } catch (axErr) {
    if (axErr.response) {
      const err2 = new Error(`HTTP ${axErr.response.status}`);
      err2.statusCode = axErr.response.status;
      throw err2;
    }
    throw axErr;
  }
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/html, application/xhtml+xml, */*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://tracker.gg/",
  "Origin": "https://tracker.gg",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

// الخريطة دي بتطابق PLATFORM_MAP في lib/providers/apex.js
const PLATFORM_MAP = {
  origin: "origin",
  steam: "origin", // Steam بيستخدم اسم الـ Origin المرتبط به
  epic: "origin",
  psn: "psn",
  xbl: "xbl",
};

async function fetchApexScraped(platform, trackerId) {
  const trnPlatform = PLATFORM_MAP[platform];
  if (!trnPlatform) {
    const err = new Error(`منصة غير مدعومة لـ Apex Legends: ${platform}`);
    err.statusCode = 400;
    throw err;
  }

  const slug = encodeURIComponent(trackerId);

  // ==== الـ internal API اللي بيغذي صفحة tracker.network ====
  const apiUrl = `https://api.tracker.gg/api/v2/apex/standard/profile/${trnPlatform}/${slug}`;
  try {
    const apiRes = await httpGet(apiUrl, {
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
      timeout: 20000,
    });
    const payload = JSON.parse(apiRes.data)?.data;
    if (payload && Array.isArray(payload.segments) && payload.segments.length) {
      return parseInternalApi(payload);
    }
    throw new Error("internal API استجاب من غير بيانات segments");
    } catch (err) {
    // لو الـ API الداخلي اتحظر (403/429) ننزل للـ HTML scraping
    if (err.statusCode === 403 || err.statusCode === 429 || err.response?.status === 403 || err.response?.status === 429) {
      return scrapeHtmlFallback(trnPlatform, slug);
    }
    if (err.statusCode === 404 || err.response?.status === 404) {
      const notFound = new Error(
        "مش لاقيين اللاعب ده على Tracker.gg — تأكد من اسم اللاعب والمنصة (لـ Steam استخدم اسم الـ Origin المرتبط)"
      );
      notFound.statusCode = 404;
      throw notFound;
    }
    throw err;
  }}

// ===== تحويل رد الـ internal API =====
function parseInternalApi(data) {
  const segments = data.segments || [];
  const overview = segments.find((s) => s.type === "overview") || segments[0];
  const stats = overview?.stats || {};

  // المستوى
  const rawLevel = stats.level?.value ?? null;

  // الرانك: rankScore.metadata.rankName + rankScore.value (RP)
  const rankScoreStat = stats.rankScore;
  const rankName = rankScoreStat?.metadata?.rankName || null;
  const rankScore = rankScoreStat?.value ?? null;
  const rank = rankName && rankName !== "Unranked" ? rankName : null;

  // Arena رانك
  const arenaRankStat = stats.arenaRankScore;
  const arenaRank = arenaRankStat?.metadata?.rankName || null;
  const arenaRankScore = arenaRankStat?.value ?? null;

  return {
    level: rawLevel,
    rank,
    rankScore,
    arenaRank,
    arenaRankScore,
    mmr: rankScore, // في Apex الـ RP = MMR التقريبي
    matches: stats.matchesPlayed?.value ?? null,
    rankDetails: {
      level: rawLevel,
      rankName,
      rankScore,
      lifetimePeakRankName: stats.lifetimePeakRankScore?.metadata?.rankName || null,
      lifetimePeakRankScore: stats.lifetimePeakRankScore?.value ?? null,
    },
    source: "tracker-scrape",
    raw: data,
  };
}

// ===== الطريقة 2 (آخر محاولة): HTML scraping بـ cheerio =====
async function scrapeHtmlFallback(trnPlatform, slug) {
  const pageUrl = `https://tracker.gg/apex-legends/profile/${trnPlatform}/${slug}/overview`;
  const htmlRes = await httpGet(pageUrl, {
    headers: { ...BROWSER_HEADERS, Accept: "text/html" },
    timeout: 15000,
  });

  const $ = cheerio.load(htmlRes.data);

  const script = $("script")
    .map((i, el) => $(el).text())
    .get()
    .find((t) => t.includes("__INITIAL_STATE__"));

  if (script) {
    const match = script.match(/__INITIAL_STATE__\s*=\s*(\{.*?\})\s*<\/?script/s);
    if (match) {
      try {
        const state = JSON.parse(match[1]);
        if (state?.stats?.segments?.length) {
          return parseInternalApi(state.stats);
        }
      } catch {
        // تجاهل — نكمل للـ DOM
      }
    }
  }

  const rows = [];
  $("[data-playlist], .playlist-row, .segment-row, tr[data-season]").each((i, el) => {
    rows.push({
      playlist: $(el).find(".playlist-name, .segment-name").text().trim() || null,
      rank: $(el).find(".tier-name, .rank-name").text().trim() || null,
      mmr: $(el).find(".rating, .mmr").text().trim() || null,
    });
  });

  if (rows.length) {
    const best = rows.find((r) => r.rank);
    return {
      level: null,
      rank: best?.rank || null,
      rankScore: null,
      arenaRank: null,
      arenaRankScore: null,
      mmr: null,
      matches: null,
      rankDetails: rows,
      source: "tracker-scrape",
      raw: htmlRes.data,
    };
  }

  const err = new Error(
    "مقدرناش نجيب بيانات اللاعب من Tracker.gg (الـ internal API اتقفل والـ HTML مافيهوش بيانات)"
  );
  err.statusCode = 502;
  throw err;
}

module.exports = { fetchApexScraped };
