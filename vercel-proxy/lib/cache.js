/* ============================================
   GAME OVER — Cache Layer (مستوى/رانك مش يتحدث كل مرة)
   ------------------------------------------------
   الفكرة: الـ level/rank ثابتة نسبياً — مفيش داعي نضرب الـ API
   (أو الـ scraping) في كل طلب. بنخزن النتيجة في الذاكرة لمدة،
   وأي طلب في الفترة دي بيرجع نفس النتيجة من غير ما يلمس المصدر.

   المدد (عشوائية لكل حساب):
   - Apex: عشوائي بين 4 و8 دقايق (240-480 ثانية).
   - Rocket League: عشوائي بين 5 و10 دقايق (300-600 ثانية).
   - كل تحديث بياخد مدة جديدة، فمش بيبان نمط ثابت (وكأن حد
     بيتابع يدوي مش اسكريبت).

   ملحوظة: التخزين في الذاكرة (in-memory) — على Vercel بيشتغل
   طالما الـ instance لسه دافئ. لو عايز التخزين يثبت بين كل
   الـ instances، نضيف Vercel KV / Upstash Redis بعدين.
   ============================================ */

const MIN_TTL_MS = 4 * 60 * 1000; // 4 دقايق
const MAX_TTL_MS = 10 * 60 * 1000; // 10 دقايق

// حدود Rocket League: 5-10 دقايق
const RL_MIN_TTL_MS = 5 * 60 * 1000;
const RL_MAX_TTL_MS = 10 * 60 * 1000;

// حدود Apex: 4-8 دقايق
const APEX_MIN_TTL_MS = 4 * 60 * 1000;
const APEX_MAX_TTL_MS = 8 * 60 * 1000;

const ROCKET_LEAGUE = "rocket-league";

// التخزين: key → { data, expiresAt }
const store = new Map();

// إزالة المدخلات اللي انتهت مدة صلاحيتها (من غير ما نمسح اللي لسه شغالة)
function prune() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

// مدة صلاحية عشوائية — كل لعبة ليها المدى بتاعها
function ttlFor(game) {
  if (game === ROCKET_LEAGUE) {
    return RL_MIN_TTL_MS + Math.floor(Math.random() * (RL_MAX_TTL_MS - RL_MIN_TTL_MS + 1));
  }
  // Apex وأي لعبة تانية: 4-8 دقايق
  return APEX_MIN_TTL_MS + Math.floor(Math.random() * (APEX_MAX_TTL_MS - APEX_MIN_TTL_MS + 1));
}

// مفتاح فريد لكل (لعبة + منصة + حساب) — نطبيع الـ trackerId عشان
// نفس الحساب بمسميات متشابهة (حروف كبيرة/صغيرة) ياخد نفس الكاش.
function cacheKey(game, platform, trackerId) {
  return `${game}|${platform.toLowerCase()}|${trackerId.trim().toLowerCase()}`;
}

// بيرجّع البيانات المخزنة لو لسه صالحة، أو null
function get(game, platform, trackerId) {
  prune();
  const entry = store.get(cacheKey(game, platform, trackerId));
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.data;
}

// بيخزن البيانات بمدة صلاحية (عشوائية لـ Rocket League)
function set(game, platform, trackerId, data) {
  prune();
  const ttl = ttlFor(game);
  store.set(cacheKey(game, platform, trackerId), {
    data,
    expiresAt: Date.now() + ttl,
  });
}

// مفيدة للتست — نفضّي الكاش
function clear() {
  store.clear();
}

module.exports = { get, set, clear, ttlFor };
