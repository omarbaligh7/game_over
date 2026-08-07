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
     للملف ده، فالـ Express جوه بيستقبل المسار الكامل زي ما هو
     (/api/ping, /api/getLevel) — عشان كده الراوتات هنا متكتوبة بـ /api/...
   - مفيش app.listen() هنا لأن Vercel هو اللي بيشغّل الفانكشن، احنا بس
     بنصدّر الـ Express app عادي.
   ============================================ */

const express = require("express");
const cors = require("cors");
const { TRN_API_KEY, ALLOWED_ORIGINS } = require("../lib/config");
const { getProvider, supportedGames } = require("../lib/providers");

const app = express();
app.use(express.json());

app.use(cors({ origin: true }));

// ============= صحة السيرفر (اختباري) =============
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, supportedGames: supportedGames() });
});

// ============= المسار الرئيسي: جلب المستوى/الرانك =============
// Body متوقع: { game: "apex", platform: "origin", trackerId: "SomePlayer" }
app.post("/api/getLevel", async (req, res) => {
  try {
    const { game, platform, trackerId } = req.body || {};

    if (!game || !platform || !trackerId) {
      return res.status(400).json({ error: "لازم تبعت: game, platform, trackerId" });
    }

    if (!TRN_API_KEY || TRN_API_KEY === "a62af854-2501-4d3f-bede-66876f21fa30") {
      return res.status(500).json({
        error: "لسه محدّدتش TRN_API_KEY (في lib/config.js أو Environment Variables على Vercel)",
      });
    }

    const provider = getProvider(game);
    if (!provider) {
      return res.status(400).json({
        error: `اللعبة "${game}" مش مدعومة لسه. الألعاب المدعومة حالياً: ${supportedGames().join(", ")}`,
      });
    }

    const result = await provider(platform, trackerId, TRN_API_KEY);

    if (result.level === null && result.rank === null) {
      return res.status(404).json({
        error: "الحساب اتلاقى بس مفيش بيانات مستوى/رانك واضحة في رد Tracker.gg",
      });
    }

    return res.json({
      ok: true,
      game,
      platform,
      trackerId,
      level: result.level,
      rank: result.rank,
    });
  } catch (err) {
    console.error("getLevel error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "خطأ غير متوقع في السيرفر" });
  }
});

// أي مسار تاني تحت /api مش متعرّف
app.use("/api", (req, res) => {
  res.status(404).json({ error: "مسار غير معروف" });
});

module.exports = app;
