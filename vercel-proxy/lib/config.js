/* ============================================
   GAME OVER — Tracker.gg Proxy Config (Vercel)
   ------------------------------------------------
   حط الـ API Key بتاعك هنا يدوياً (من tracker.gg/developers).
   الأفضل عملياً (وأأمن) إنك تستخدم Environment Variables في Vercel
   بدل ما تكتب المفتاح صريح هنا — شرحنا الطريقتين تحت.
   ============================================ */

// 🔑 حط مفتاح الـ API بتاعك هنا (لو مش مستخدم Environment Variable):
const TRN_API_KEY = process.env.TRN_API_KEY || "";

// 🔑 مفتاح Apex Legends من apexlegendsstatus.com
// (مختلف عن Tracker.gg — ده مصدر مستقل لـ Apex)
const APEX_API_KEY = process.env.APEX_API_KEY || "5c2102130feeb58b159396a5e30f8ffa";

// الدومينات المسموح لها تكلم البروكسي ده (CORS) — ملحوظة: البروكسي
// في الواقع بيرد بـ Access-Control-Allow-Origin: * لكل الدومينات،
// فالقائمة دي للمرجعية فقط وموجودة عشان لو حبيت تقفل على دومينات محددة.
const ALLOWED_ORIGINS = [
  "https://game-over-2f480.web.app",
  "https://game-over-2f480.firebaseapp.com",
  "http://localhost:5000", // مفيد وقت التجربة المحلية (firebase serve / live-server)
];

// خريطة كل لعبة → الـ API Key الخاص بها
// (كل مصدر ممكن يكون له مفتاح مختلف عن التاني)
const GAME_API_KEYS = {
  apex: APEX_API_KEY,
  "rocket-league": TRN_API_KEY,
};

// ترجع الـ API Key بتاعة لعبة معينة (أو "" لو مفيش)
function getApiKey(game) {
  return GAME_API_KEYS[game] || "";
}

module.exports = { TRN_API_KEY, APEX_API_KEY, ALLOWED_ORIGINS, getApiKey };

/* ⚠️ الطريقة الأأمن (موصى بيها) — استخدام Environment Variables في Vercel:
   1) من لوحة تحكم Vercel: Project → Settings → Environment Variables
   2) ضيف متغير اسمه TRN_API_KEY وقيمته مفتاحك، لكل الـ Environments
      (Production, Preview, Development)
   3) بعد الإضافة، اعمل Redeploy للمشروع عشان يقرأ المتغير الجديد
   بالطريقة دي، الكود بياخد المفتاح تلقائياً من process.env.TRN_API_KEY
   من غير ما يتكتب في أي ملف بيترفع على GitHub. */
