/* ============================================
   GAME OVER — Backend Proxy (Firebase Cloud Function)
   ------------------------------------------------
   ليه محتاجين السيرفر ده أصلاً؟
   - Tracker.gg بيرفض الطلبات اللي جاية مباشرة من المتصفح (CORS) لأسباب أمان.
   - كمان مش آمن إننا نحط TRN-Api-Key في كود الفرونت إند (app.js) لأنه
     ظاهر لأي حد يفتح Developer Tools. فالمفتاح لازم يفضل في السيرفر بس.

   إزاي تنزّل الملف ده؟
     1) firebase init functions   (لو أول مرة، اختار Node.js 18/20 و JavaScript)
     2) انسخ الملف ده + config.js + مجلد providers/ جوه مجلد functions/
     3) افتح functions/config.js وحط الـ TRN_API_KEY بتاعك
     4) cd functions && npm install
     5) firebase deploy --only functions
   الرابط اللي هتحصل عليه هيبقى شكله:
     https://us-central1-<project-id>.cloudfunctions.net/api/getLevel
   ============================================ */

const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const { TRN_API_KEY, ALLOWED_ORIGIN } = require("./config");
const { getProvider, supportedGames } = require("./providers");

const app = express();
app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN }));

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
      return res.status(400).json({
        error: "لازم تبعت: game, platform, trackerId",
      });
    }

    if (TRN_API_KEY === "YOUR_TRACKER_GG_API_KEY_HERE") {
      return res.status(500).json({
        error: "لسه محدّدتش TRN_API_KEY في functions/config.js",
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

// Firebase هيعرض كل الـ routes اللي فوق تحت اسم "api"
exports.api = functions.https.onRequest(app);
