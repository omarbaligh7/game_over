# ميزة التحديث التلقائي لمستوى الحسابات (Tracker.gg)

## الملفات اللي اتضافت/اتعدّلت

| الملف | جديد/معدّل | الوظيفة |
|---|---|---|
| `functions/index.js` | جديد | Cloud Function (Express app) — بتستقبل `{game, platform, trackerId}` وترجع `{level, rank}` |
| `functions/config.js` | جديد | فيه `TRN_API_KEY` — **حط مفتاحك هنا يدوياً** |
| `functions/providers/apex.js` | جديد | منطق الاتصال بـ Tracker.gg الخاص بـ Apex Legends تحديداً |
| `functions/providers/index.js` | جديد | سجل الألعاب المدعومة — تضيف لعبة جديدة هنا بسطر واحد |
| `functions/package.json` | جديد | Dependencies للسيرفر (`express`, `cors`, `firebase-functions`) |
| `tracker-config.js` | جديد | رابط الـ Cloud Function اللي الفرونت إند بيكلمه |
| `index.html` | معدّل | إضافة `<script src="tracker-config.js">` قبل `app.js` |
| `app.js` | معدّل | حقول Platform + Tracker ID في نموذج الحساب، زرار 🔄 في الكارت وفي النموذج، منطق الاتصال بالسيرفر وتحديث Firestore |

## خطوات التشغيل

1. **فعّل Cloud Functions على مشروعك** (لو أول مرة):
   ```bash
   npm install -g firebase-tools   # لو مش متثبت
   firebase login
   cd /path/to/game-over-project
   firebase init functions        # اختار المشروع game-over-2f480، ولو سأل عن اللغة اختار JavaScript
   ```
   لو عندك مجلد `functions/` جاهز زي اللي جبناه، تقدر تستبدل الملفات اللي اتعملت بالـ `firebase init` بالملفات دي مباشرة.

2. **حط الـ API Key بتاعك** في `functions/config.js`:
   ```js
   const TRN_API_KEY = "a62af854-2501-4d3f-bede-66876f21fa30";
   ```
   تقدر تجيب مفتاح من: https://tracker.gg/developers

3. **ثبّت الحزم ونشر السيرفر**:
   ```bash
   cd functions
   npm install
   cd ..
   firebase deploy --only functions
   ```
   هيديك رابط شكله:
   `https://us-central1-game-over-2f480.cloudfunctions.net/api`
   (ده هو نفسه اللي متحط بالفعل في `tracker-config.js` — لو الـ region اتغيّر، عدّله هناك).

4. **جرّب الميزة من اللوحة**:
   - افتح "إضافة/تعديل حساب" واختار لعبة اسمها فيه كلمة "Apex" (زي "Apex Legends").
   - هيظهر تلقائياً حقل المنصة (Origin/PSN/Xbox/Steam/Epic) وحقل معرف التتبع.
   - اختار المنصة واكتب الاسم، ودوس زرار **"🔄 جلب المستوى من Tracker.gg"**.
   - المستوى (والرانك لو موجود) هيتملى تلقائياً — احفظ الحساب عادي وهيتخزن في Firestore زي أي حساب تاني.
   - بعد كده، هيظهر زرار 🔄 صغير جوه كارت الحساب نفسه لتحديث سريع بدون فتح نموذج التعديل.

## إضافة لعبة جديدة مستقبلاً (مثال Rocket League)

1. `functions/providers/rocket-league.js` — بنفس شكل `apex.js` بالظبط (نفس الـ return: `{level, rank, raw}`).
2. في `functions/providers/index.js`:
   ```js
   const { fetchRocketLeagueProfile } = require("./rocket-league");
   const PROVIDERS = {
     apex: fetchApexProfile,
     "rocket-league": fetchRocketLeagueProfile,
   };
   ```
3. في `app.js` جوه `TRACKER_GAMES`:
   ```js
   'rocket-league': { slug: 'rocket-league', label: 'Rocket League', match: /rocket\s*league/i },
   ```
   ده بس، مفيش أي تعديل تاني — الفرونت إند والـ endpoint العام بيتعاملوا مع أي لعبة متسجلة تلقائياً.

## ملاحظة أمان

- الـ API Key بيفضل في السيرفر بس (`functions/config.js`) — أبداً متحطوش في `app.js` أو أي ملف بيتحمّل في المتصفح.
- لو المشروع هيبقى على GitHub بشكل عام، حوّل المفتاح لـ Firebase Secret Manager بدل ما يبقى نص صريح في الملف (الخطوات مكتوبة كتعليق جوه `functions/config.js`).
