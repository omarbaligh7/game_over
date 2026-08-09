/* ============================================
   GAME OVER — Tracker.gg Backend Proxy (Vercel)
   ------------------------------------------------
   بديل Firebase Cloud Functions — نفس الوظيفة بالظبط (بروكسي بينك وبين
   Tracker.gg يحل مشكلة CORS ويخبّي الـ API Key)، بس شغال على Vercel
   مجاناً بدون أي فيزا أو ترقية.

   ملحوظة مهمة عن الـ Routing:
   - الملف ده موجود في api/index.js، وده بيخليه الـ "Serverless Function"
     الافتراضي عند Vercel.
   - ملف vercel.json (جنبه) بيعمل rewrite لأي طلب تحت /api/* عشان يوصل
     للملف ده.
   - حقيقة سلوك Vercel بيختلف: أحياناً بيوصل المسار كامل (/api/ping) وأحياناً
     بيوصلك من غيرها (بعد ما ياخد البادئة). عشان كده الميدل وير اللي تحت
     بيتخلّص من بادئة "/api" لو كانت موجودة، وبعدين الراوتات متكتوبة بدون
     البادئة (/ping, /getLevel) — فشغالة في الحالتين.
   - مفيش app.listen() هنا لأن Vercel هو اللي بيشغّل الفانكشن، احنا بس
     بنصدّر الـ Express app عادي.
   ============================================ */

const express = require("express");
const cors = require("cors");
const { getApiKey } = require("../lib/config");
const { getProvider, supportedGames } = require("../lib/providers");
const cache = require("../lib/cache");

const app = express();
app.use(express.json());

// CORS مفتوح لكل الدومينات (GitHub Pages وغيره) + معالجة الـ OPTIONS (preflight)
app.use(cors({ origin: true, methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS", allowedHeaders: "Content-Type,Authorization,X-Requested-With" }));

// ===== تطبيع المسار: يشيل بادئة /api لو وصلت =====
// عشان /api/ping و /ping يشتغلوا بنفس الطريقة مهما وصل المسار إزاي.
app.use((req, res, next) => {
  if (req.url === "/api" || req.url.startsWith("/api/")) {
    const rest = req.url.slice(4); // يشيل "/api"
    req.url = rest === "" ? "/" : rest;
  }
  next();
});

// ============= صحة السيرفر (اختباري) =============
app.get("/ping", (req, res) => {
  res.json({ ok: true, supportedGames: supportedGames() });
});

// ============= المسار الرئيسي: جلب المستوى/الرانك =============
// Body متوقع: { game: "apex", platform: "origin", trackerId: "SomePlayer" }
app.post("/getLevel", async (req, res) => {
  try {
    const { game, platform, trackerId } = req.body || {};

    if (!game || !platform || !trackerId) {
      return res.status(400).json({ error: "لازم تبعت: game, platform, trackerId" });
    }

    // ===== الكاش: لو فيه بيانات لسه صالحة نرجّعها من غير ما نلمس المصدر =====
    const cached = cache.get(game, platform, trackerId);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const provider = getProvider(game);
    if (!provider) {
      return res.status(400).json({
        error: `اللعبة "${game}" مش مدعومة لسه. الألعاب المدعومة حالياً: ${supportedGames().join(", ")}`,
      });
    }

    const apiKey = getApiKey(game);

    // لو مفيش مفتاح رسمي للعبة → ننزل مباشرة للـ scraping fallback
    let result;
    if (!apiKey) {
      result = await provider(platform, trackerId, null);
    } else {
      result = await provider(platform, trackerId, apiKey);
    }

    const body = buildResponse(game, platform, trackerId, result);

    // خزن النتيجة في الكاش (مدة: ثابتة 10 دقايق لـ Apex، عشوائية 5-10 لـ Rocket League)
    cache.set(game, platform, trackerId, body);

    return res.json(body);
  } catch (err) {
    console.error("getLevel error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "خطأ غير متوقع في السيرفر" });
  }
});

// بتبني جسم الرد الموحد من نتيجة الـ provider
function buildResponse(game, platform, trackerId, result) {
  if (result.level === null && result.rank === null) {
    const err = new Error("الحساب اتلاقى بس مفيش بيانات مستوى/رانك واضحة في رد المصدر");
    err.statusCode = 404;
    throw err;
  }

  return {
    ok: true,
    game,
    platform,
    trackerId,
    level: result.level,
    rank: result.rank,
    rankScore: result.rankScore ?? null,
    arenaRank: result.arenaRank ?? null,
    arenaRankScore: result.arenaRankScore ?? null,
    mmr: result.mmr ?? null,
    matches: result.matches ?? null,
    rankDetails: result.rankDetails ?? null,
    // حقول إضافية (VALORANT): اسم الحساب + الـ Tag + صورة الـ Card + أعلى رانك
    name: result.name ?? null,
    tag: result.tag ?? null,
    avatar: result.avatar ?? null,
    peakRank: result.peakRank ?? null,
    source: result.source ?? "official",
    apiKeyError: result.apiKeyError ?? null,
    cached: false,
  };
}

// ============= VALORANT: جلب بيانات الحساب (اسم + Tag) =============
// GET /api/valorant/:name/:tag  — مثال: /api/valorant/TenZ/SEN
// لو المستخدم كتب الـ tag بعلامة # (زي TenZ#SEN أو TenZ/xx#123) هننضّفها.
app.get("/valorant/:name/:tag", async (req, res) => {
  try {
    let { name, tag } = req.params;
    name = String(name || "").trim();
    tag = String(tag || "").replace(/#/g, "").trim();

    if (!name || !tag) {
      return res.status(400).json({ error: "لازم تبعت الاسم والـ Tag" });
    }

    // لو الاسم وصل بصيغة "Name#Tag" نقسمه (لو المستخدم دخل السطر كله في خانة الاسم)
    if (name.includes("#")) {
      const parts = name.split("#");
      name = parts[0].trim();
      if (!tag) tag = parts.slice(1).join("#").replace(/#/g, "").trim();
    }

    const trackerId = `${name}#${tag}`;

    // الكاش: نفس نظام الألعاب التانية
    const cached = cache.get("valorant", "riot", trackerId);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const provider = getProvider("valorant");
    const apiKey = getApiKey("valorant");
    const result = await provider("pc", trackerId, apiKey);

    const body = buildResponse("valorant", "riot", trackerId, result);
    cache.set("valorant", "riot", trackerId, body);
    return res.json(body);
  } catch (err) {
    console.error("valorant endpoint error:", err);
    const status = err.statusCode || err.response?.status || 500;
    const message =
      status === 404
        ? "الحساب ده مش موجود على VALORANT — تأكد من الاسم والـ Tag"
        : err.message || "خطأ غير متوقع في السيرفر";
    return res.status(status).json({ error: message });
  }
});

// أي مسار تاني مش متعرّف
app.use((req, res) => {
  res.status(404).json({ error: "مسار غير معروف" });
});

module.exports = app;
