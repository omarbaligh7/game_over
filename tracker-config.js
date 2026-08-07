/* ============================================
   GAME OVER — Tracker.gg Frontend Config
   ------------------------------------------------
   الرابط ده هو رابط الـ Cloud Function اللي عملناها في functions/index.js
   (exports.api). مبني تلقائياً من project ID بتاعك (game-over-2f480)
   والـ region الافتراضي (us-central1).

   لو غيّرت الـ region وقت firebase deploy، عدّل الرابط هنا كمان.
   ============================================ */

window.TRACKER_API_BASE = "https://us-central1-game-over-2f480.cloudfunctions.net/api";
