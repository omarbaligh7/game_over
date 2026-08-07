/* ============================================
   GAME OVER — Tracker.gg Frontend Config
   ------------------------------------------------
   السيرفر الوسيط بقى شغال على Vercel (مش Firebase Functions)، عشان
   Vercel مجاني بالكامل ومحتاجش ترقية لخطة Blaze.

   بعد ما تنشر مجلد vercel-proxy على Vercel، هتاخد رابط شكله:
     https://your-project-name.vercel.app
   حط الرابط ده هنا (مع /api في الآخر) بدل الرابط اللي تحت.
   ============================================ */

window.TRACKER_API_BASE = "https://game-over-proxy.vercel.app/api";

// ملاحظة: النسخة القديمة كانت بتشاور على Firebase Cloud Functions:
// "https://us-central1-game-over-2f480.cloudfunctions.net/api"
// مبقتش مستخدمة دلوقتي — سيبناها هنا كتعليق للرجوع لو احتجتها تاني.
