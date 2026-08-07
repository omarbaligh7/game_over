# ميزة التحديث التلقائي لمستوى الحسابات (Tracker.gg)

## ⚡ تحديث: السيرفر الوسيط بقى على Vercel بدل Firebase Functions

مجلد `functions/` (Firebase) لسه موجود كمرجع بس **مبقاش مستخدم** — محتاج ترقية لخطة Blaze.
البديل الجديد هو مجلد **`vercel-proxy/`**، شغال 100% مجاني على Vercel بدون فيزا.
Firestore وباقي `app.js`/`firebase-init.js` **متغيّرش فيهم حاجة** — لسه بيستخدموا Firebase زي ما هما.

## الملفات اللي اتضافت/اتعدّلت

| الملف | جديد/معدّل | الوظيفة |
|---|---|---|
| `vercel-proxy/api/index.js` | جديد | Express app (Serverless Function) — بديل `functions/index.js` |
| `vercel-proxy/lib/config.js` | جديد | فيه `TRN_API_KEY` — **حط مفتاحك هنا أو في Environment Variables** |
| `vercel-proxy/lib/providers/apex.js` | جديد | منطق Apex Legends |
| `vercel-proxy/lib/providers/rocket-league.js` | جديد | منطق Rocket League (الرانك بدل المستوى — Rocket League مفيهوش Level كلاسيكي) |
| `vercel-proxy/lib/providers/index.js` | جديد | سجل الألعاب المدعومة |
| `vercel-proxy/vercel.json` | جديد | Routing + CORS headers |
| `vercel-proxy/package.json` | جديد | Dependencies (`express`, `cors`) |
| `tracker-config.js` | معدّل | بيشاور على رابط Vercel الجديد بدل Firebase Functions |
| `app.js` | معدّل (جزء التتبع بس) | ضيف Rocket League في `TRACKER_GAMES` — مفيش أي لمس لكود Firestore |
| `index.html` | معدّل سابقاً | إضافة `<script src="tracker-config.js">` قبل `app.js` (زي ما هو) |

## خطوات النشر على Vercel (مجاني بدون فيزا)

### الطريقة 1 — عن طريق GitHub (الأسهل للتحديثات المستقبلية)

1. ارفع مجلد `vercel-proxy/` بس (أو المشروع كله، مش هيأثر) على ريبو GitHub منفصل أو جوه نفس الريبو.
2. روح على https://vercel.com وسجّل دخول بحساب GitHub بتاعك (مجاني تمامًا، مفيش فيزا مطلوبة).
3. من الداشبورد: **Add New → Project**.
4. اختار الريبو بتاعك. **مهم:** لو الملفات جوه مجلد فرعي زي `vercel-proxy/`، حط في خانة **Root Directory** اسم `vercel-proxy` (Vercel بيسألك عليها وقت الإعداد).
5. Framework Preset: سيبه **Other** (مفيش build مطلوب، فانكشنز serverless بس).
6. قبل الضغط على Deploy، افتح **Environment Variables** وضيف:
   - Key: `TRN_API_KEY`
   - Value: مفتاحك من tracker.gg/developers
   - طبّقها على Production + Preview + Development
7. دوس **Deploy**. هتاخد رابط شكله: `https://your-project-name.vercel.app`

### الطريقة 2 — رفع مباشر بالـ CLI (بدون GitHub)

```bash
npm install -g vercel      # لو مش متثبت
cd vercel-proxy
vercel login               # هيفتحلك المتصفح تسجل دخول (بريد إلكتروني كفاية، مفيش فيزا)
vercel                     # أول نشر تجريبي (Preview)
vercel --prod               # النشر النهائي (Production) — ده الرابط اللي تستخدمه
```
هيسألك أسئلة بسيطة (اسم المشروع، هل تربطه بمشروع موجود...) — اقبل الافتراضي.
لو عايز تضيف `TRN_API_KEY` من الترمينال بدل الموقع:
```bash
vercel env add TRN_API_KEY production
```

### بعد الحصول على الرابط

1. افتح `tracker-config.js` وحط رابطك بدل الـ placeholder:
   ```js
   window.TRACKER_API_BASE = "https://your-project-name.vercel.app/api";
   ```
2. جرّب الرابط مباشرة في المتصفح للتأكد إن السيرفر شغال:
   `https://your-project-name.vercel.app/api/ping` → المفروض ترجع `{"ok":true, "supportedGames":["apex","rocket-league"]}`
3. ارفع `tracker-config.js` المعدّل مع باقي مشروع الفرونت إند (Firebase Hosting) عادي.

## جرّب الميزة من اللوحة

- افتح "إضافة/تعديل حساب" واختار لعبة اسمها فيه "Apex" أو "Rocket League".
- هيظهر تلقائياً حقل المنصة وحقل معرف التتبع.
- دوس **"🔄 جلب المستوى من Tracker.gg"** — المستوى (والرانك) هيتملى تلقائياً.
- زرار 🔄 السريع جوه الكارت شغال بنفس الطريقة.

## إضافة لعبة جديدة مستقبلاً

1. `vercel-proxy/lib/providers/<game>.js` — بنفس شكل `apex.js` (نفس الـ return: `{level, rank, raw}`).
2. سجّله في `vercel-proxy/lib/providers/index.js`.
3. ضيف سطر في `TRACKER_GAMES` جوه `app.js`.
4. اعمل `git push` (لو مربوط بـ GitHub، Vercel بينشر تلقائي) أو `vercel --prod` يدوياً.

## ملاحظة أمان

- الأفضل تستخدم **Environment Variables** في Vercel بدل ما تكتب الـ API Key صريح جوه `lib/config.js` — خصوصاً لو الريبو عام على GitHub.
- الكود بيقرأ `process.env.TRN_API_KEY` تلقائياً لو موجود، فمش لازم تعدّل الملف خالص لو مستخدم الطريقة دي.

