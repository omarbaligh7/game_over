/* ============================================
   GAME OVER — Tracker.gg Web Scraping Fallback (خطة ب)
   ------------------------------------------------
   ليه ده موجود؟:
   - الـ Production API Key بياخد وقت في المراجعة، فممكن يجيب 401.
   - الحل: الموقع نفسه (rocketleague.tracker.network) بيستخدم API
     داخلي بيشتغل من غير مفتاح — نستدعيه ببنية متصفح حقيقية.
   - لو ده فشل، ننزل لـ HTML scraping بـ cheerio كآخر محاولة.

   ملاحظة: الصفحة Client-Side Rendering (البيانات مش جوا الـ HTML)،
   فالـ cheerio على HTML مش بيجيب البيانات غالباً — الطريقة الأولانية
   (internal API) هي المضمونة. cheerio موجود كطبقة دفاعية بس.
   ============================================ */

const axios = require("axios");
const cheerio = require("cheerio");

// curl-cffi بيمرّر TLS fingerprint لمتصفح حقيقي (impersonate) —
// دي الطريقة الوحيدة اللي بتعدي حماية Cloudflare من Node.
// استدعاؤه ممكن يفشل لو الـ install script ما اتنفذش (بيئة Vercel
// بتبني من الصفر) — بنلفّه بحيث ننزل لأي fallback تاني.
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

// نداء بـ curl-cffi (impersonate chrome) مع fallback لـ axios
// لو الـ impersonate فشل أو الـ package مش متاح (مثلاً على Vercel لو
// الـ install script اترفض)، ننزل للـ axios العادي.
// قيم impersonate نجرّبها بالترتيب — لو وحدة رجّعت 403/429 نجرّب اللي بعدها
// (نسخة Linux من libcurl-impersonate ممكن يختلف TLS fingerprint بتاعها عن Windows)
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
          // res.data بييجي أحياناً كائن parsed وأحياناً string، وres.text بيجيب النص
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
        // لو رجع 403/429 نجرّب الـ impersonate اللي بعده
      } catch (e) {
        lastErr = e;
        if (e.statusCode === 403 || e.statusCode === 429) continue;
        // أي فشل تاني (شبكة، handle، إلخ) → ننزل للـ axios
        break;
      }
    }
    if (lastErr) throw lastErr;
  }

  // ==== Fallback: axios (بنية Node العادية — غالباً هتترفض بـ 403 من Cloudflare،
  // ==== لكن لو الـ curl-cffi مش متاح أصلاً ده آخر أمل) ====
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

// بنية متصفح حقيقي — عشان منع الحظر من Cloudflare/أكادما
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/html, application/xhtml+xml, */*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://rocketleague.tracker.network/",
  "Origin": "https://rocketleague.tracker.network",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

// الخريطة دي بتطابق PLATFORM_MAP في lib/providers/rocket-league.js
const PLATFORM_MAP = {
  steam: "steam",
  psn: "psn",
  xbl: "xbl",
  epic: "epic",
  origin: "epic",
};

// أسماء الـ playlists المعروفة لـ Rocket League (playlistId → اسم شائع)
const PLAYLIST_NAMES = {
  10: "1v1 Duel",
  11: "2v2 Doubles",
  13: "3v3 Standard",
  27: "Hoops",
  28: "Rumble",
  29: "Dropshot",
  30: "Tournament",
  61: "Heatseeker",
  0: "Casual",
};

async function fetchRocketLeagueScraped(platform, trackerId) {
  const trnPlatform = PLATFORM_MAP[platform];
  if (!trnPlatform) {
    const err = new Error(`منصة غير مدعومة لـ Rocket League: ${platform}`);
    err.statusCode = 400;
    throw err;
  }

  const slug = encodeURIComponent(trackerId);

  // ==== الطريقة 1 (الأفضل): الـ internal API اللي بيغذي صفحة tracker.network ====
  const apiUrl = `https://api.tracker.gg/api/v2/rocket-league/standard/profile/${trnPlatform}/${slug}`;
  try {
    const apiRes = await httpGet(apiUrl, {
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
      timeout: 15000,
    });
    const payload = JSON.parse(apiRes.data)?.data;
    if (payload && Array.isArray(payload.segments) && payload.segments.length) {
      return parseInternalApi(payload);
    }
    throw new Error("internal API استجاب من غير بيانات segments");
  } catch (err) {
    // لو الـ API الداخلي اتحظر (403/429) ننزل للـ HTML scraping
    if (err.response?.status === 403 || err.response?.status === 429) {
      return scrapeHtmlFallback(trnPlatform, slug);
    }
    throw err;
  }
}

// ===== تحويل رد الـ internal API (نفس شكل الـ API الرسمي) =====
function parseInternalApi(data) {
  const segments = data.segments || [];
  const overview = segments.find((s) => s.type === "overview") || segments[0];
  const stats = overview?.stats || {};

  // الـ playlists اللي عليها MMR فعلي (1v1/2v2/3v3...)
  const playlistSegments = segments
    .filter((s) => s.type === "playlist" && s.stats?.rating?.value != null)
    .map((s) => ({
      playlistId: s.attributes?.playlistId,
      name:
        PLAYLIST_NAMES[s.attributes?.playlistId] ||
        `Playlist ${s.attributes?.playlistId}`,
      rank: s.stats?.tier?.metadata?.name || s.stats?.rating?.metadata?.tierName || null,
      division: s.stats?.division?.metadata?.name || null,
      mmr: s.stats?.rating?.value ?? null,
      matches: s.stats?.matchesPlayed?.value ?? null,
    }));

  // نرتب تنازلياً حسب الـ MMR — أول عنصر هو أعلى رانك
  playlistSegments.sort((a, b) => (b.mmr ?? 0) - (a.mmr ?? 0));

  const best = playlistSegments[0] || null;

  const totalMatches = playlistSegments.reduce(
    (sum, p) => sum + (Number(p.matches) || 0),
    0
  );

  return {
    level: null, // Rocket League مفيهوش level كلاسيكي
    rank: best ? (best.division ? `${best.rank} ${best.division}` : best.rank) : null,
    rankDetails: playlistSegments.map((p) => ({
      playlist: p.name,
      rank: p.rank,
      division: p.division,
      mmr: p.mmr,
      matches: p.matches,
    })),
    mmr: best?.mmr ?? null,
    matches: totalMatches,
    raw: data,
  };
}

// ===== الطريقة 2 (آخر محاولة): HTML scraping بـ cheerio =====
// ملحوظة: البيانات مش في الـ HTML الأصلي، فده نادراً ما ينجح —
// موجود كطبقة دفاعية في حالة الموقع رجّع نسخة SSR قديمة.
async function scrapeHtmlFallback(trnPlatform, slug) {
  const pageUrl = `https://rocketleague.tracker.network/rocket-league/profile/${trnPlatform}/${slug}/overview`;
  const htmlRes = await httpGet(pageUrl, {
    headers: { ...BROWSER_HEADERS, Accept: "text/html" },
    timeout: 15000,
  });

  const $ = cheerio.load(htmlRes.data);

  // بنجرب نطلع أي JSON مدمج في الصفحة (__INITIAL_STATE__)
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

  // محاولة DOM عامة — شغالة لو الموقع رجّع النسخة الـ SSR القديمة
  const rows = [];
  $("[data-playlist], .playlist-row, .segment-row, tr[data-season]").each(
    (i, el) => {
      rows.push({
        playlist: $(el).find(".playlist-name, .segment-name").text().trim() || null,
        rank: $(el).find(".tier-name, .rank-name").text().trim() || null,
        mmr: $(el).find(".rating, .mmr").text().trim() || null,
      });
    }
  );

  if (rows.length) {
    return {
      level: null,
      rank: rows.find((r) => r.rank)?.rank || null,
      rankDetails: rows,
      mmr: null,
      matches: null,
      raw: htmlRes.data,
    };
  }

  const err = new Error(
    "مقدرناش نجيب بيانات اللاعب من Tracker (الـ internal API اتقفل والـ HTML مافيهوش بيانات)"
  );
  err.statusCode = 502;
  throw err;
}

module.exports = { fetchRocketLeagueScraped };
