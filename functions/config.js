/* ============================================
   GAME OVER — Tracker.gg Backend Config
   ------------------------------------------------
   حط الـ API Key بتاعك هنا يدوياً (من حسابك على tracker.gg/developers).
   الملف ده متعمّدش يتبعت لأي حد، وميتحطش على GitHub لو المشروع عام
   (شوف .gitignore + الملاحظة الأمنية تحت).
   ============================================ */

// 🔑 حط مفتاح الـ API بتاعك هنا:
const TRN_API_KEY = "YOUR_TRACKER_GG_API_KEY_HERE";

// النطاق (Origin) المسموح له يستخدم الـ Proxy ده — حط دومين الاستضافة بتاعك
// (Firebase Hosting هيديك رابط زي: https://game-over-2f480.web.app)
// خليه '*' مؤقتاً وقت التجربة، وقيّده بعدين وقت الإنتاج.
const ALLOWED_ORIGIN = "*";

module.exports = { TRN_API_KEY, ALLOWED_ORIGIN };

/* ⚠️ ملاحظة أمان مهمة:
   لو رفعت المشروع ده على GitHub بشكل عام (public repo)، متسيبش الـ
   API Key فعلي جوه الملف ده. الطريقة الأضمن للإنتاج هي تخزين المفتاح
   في Firebase Secret Manager بدل ما يبقى نص صريح هنا:

     firebase functions:secrets:set TRN_API_KEY

   وبعدين تقرأه في index.js عن طريق:
     const { defineSecret } = require('firebase-functions/params');
     const trnApiKey = defineSecret('TRN_API_KEY');
   وتضيفه في runWith({ secrets: [trnApiKey] }) على الـ function.

   خليناها بسيطة (Placeholder) دلوقتي عشان تقدر تجرب بسرعة، وتقدر
   تنقلها لـ Secret Manager براحتك بعدين. */
