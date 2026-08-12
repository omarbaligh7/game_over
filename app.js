/* ============================================
   GAME OVER — Multi-User App Logic
   - Auth via Firebase Authentication (email/password)
   - Password reset via Firebase's own emailed link
   - Per-user data isolation (keyed by Firebase uid)
   - Purple × Mint theme
   ============================================ */

(() => {
  'use strict';

  // ============= STORAGE KEYS =============
  // REMEMBER_KEY now stores the last-used email (UI convenience only).
  // Real session/auth state lives entirely inside Firebase Authentication —
  // no custom session token is created or trusted by this app anymore.
  const REMEMBER_KEY = 'gameover_remember';

  const dataKey = (u) => `gameover_data_${u}`;

  // ============= UTIL =============
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ============= TRACKER.GG — التحديث التلقائي لمستوى الحسابات =============
  // قائمة المنصات المعروضة في نموذج الحساب. القيمة (value) هي اللي بتتبعت
  // للسيرفر الوسيط زي ما هي، وهو اللي بيترجمها لصيغة Tracker.gg الداخلية.
  const TRACKER_PLATFORMS = [
    { value: 'origin', label: 'Origin / EA App' },
    { value: 'psn', label: 'PlayStation (PSN)' },
    { value: 'xbl', label: 'Xbox (Gamertag)' },
    { value: 'steam', label: 'Steam' },
    { value: 'epic', label: 'Epic Games' },
  ];

  // خريطة "اسم اللعبة كما كتبه المستخدم" ↔ "slug اللعبة عند Tracker.gg".
  // البنية دي مرنة: أي لعبة جديدة تتدعم مستقبلاً (Rocket League مثلاً)
  // تتضاف كسطر واحد هنا + provider مطابق في functions/providers.
  const TRACKER_GAMES = {
    apex: { slug: 'apex', label: 'Apex Legends', match: /apex/i },
    'rocket-league': { slug: 'rocket-league', label: 'Rocket League', match: /rocket\s*league/i },
    valorant: { slug: 'valorant', label: 'VALORANT', match: /valorant|فالورانت|فالورنت|فالرنت/i },
  };

  // بيحاول يلاقي إعداد اللعبة عند Tracker.gg بمطابقة اسم اللعبة اللي
  // المستخدم كاتبه في اللوحة (لأن الألعاب هنا بتتضاف يدوياً بأي اسم).
  function getTrackerGameConfig(game) {
    if (!game || !game.name) return null;
    const entry = Object.values(TRACKER_GAMES).find(g => g.match.test(game.name));
    return entry || null;
  }

  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, 2400);
  }

  // ============= RIPPLE (click feedback on primary buttons) =============
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.auth-btn, .btn-primary, .add-btn.primary');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.width = span.style.height = size + 'px';
    span.style.left = (e.clientX - rect.left - size / 2) + 'px';
    span.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(span);
    span.addEventListener('animationend', () => span.remove());
  });

  // ============= COUNT-UP (animated number transitions for stats) =============
  function countUp(el, to, opts = {}) {
    if (!el) return;
    const { duration = 600, suffix = '', isCurrency = false } = opts;
    const fromText = (el.dataset.rawVal ?? '0');
    const from = Number(fromText) || 0;
    if (from === to) { el.textContent = (isCurrency ? fmt(to) + suffix : to); el.dataset.rawVal = to; return; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const val = Math.round(from + (to - from) * eased);
      el.textContent = isCurrency ? fmt(val) + suffix : val;
      if (p < 1) requestAnimationFrame(step);
      else el.dataset.rawVal = to;
    };
    requestAnimationFrame(step);
  }

  // ============= SOUND EFFECTS (Web Audio API) =============
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playSound(type = 'click') {
    try {
      const ctx = ensureAudio();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (type === 'click') {
        // Soft click
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain).connect(ctx.destination);
        osc.frequency.setValueAtTime(720, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.05);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.07);
      } else if (type === 'level-up') {
        // Bright rising ping
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain).connect(ctx.destination);
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.14);
        osc.type = 'triangle';
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
        // Add a sparkle harmonic
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2).connect(ctx.destination);
        osc2.frequency.setValueAtTime(1568, now + 0.04);
        osc2.frequency.exponentialRampToValueAtTime(2093, now + 0.16);
        osc2.type = 'sine';
        gain2.gain.setValueAtTime(0.05, now + 0.04);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc2.start(now + 0.04);
        osc2.stop(now + 0.2);
      } else if (type === 'level-down') {
        // Soft descending thud
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain).connect(ctx.destination);
        osc.frequency.setValueAtTime(380, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.09);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'status') {
        // Two-tone chime (A4 → E5)
        [440, 660].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain).connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          const t = now + i * 0.08;
          gain.gain.setValueAtTime(0.1, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          osc.start(t);
          osc.stop(t + 0.2);
        });
      } else if (type === 'success') {
        // C major arpeggio chord
        [523.25, 659.25, 783.99].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain).connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          const t = now + i * 0.06;
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.07, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
          osc.start(t);
          osc.stop(t + 0.45);
        });
      } else if (type === 'error') {
        // Descending sawtooth
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain).connect(ctx.destination);
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.22);
        osc.type = 'sawtooth';
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.start(now);
        osc.stop(now + 0.27);
      } else if (type === 'star') {
        // Sparkle
        [0, 0.06, 0.12].forEach((delay, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain).connect(ctx.destination);
          osc.frequency.value = 1200 + i * 250;
          osc.type = 'sine';
          const t = now + delay;
          gain.gain.setValueAtTime(0.04, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
          osc.start(t);
          osc.stop(t + 0.09);
        });
      } else if (type === 'open') {
        // Soft pop for opening picker
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain).connect(ctx.destination);
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(700, now + 0.07);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      }
    } catch (_) { /* audio is best-effort, never break the UI */ }
  }

  // Unlock audio on first user interaction (browsers require a gesture)
  function unlockAudioOnce() { ensureAudio(); }
  document.addEventListener('pointerdown', unlockAudioOnce, { once: true, capture: true });
  document.addEventListener('keydown', unlockAudioOnce, { once: true, capture: true });

  // ============= STATUS PICKER DROPDOWN =============
  function openStatusPicker(accountId, anchorEl) {
    closeStatusPicker();

    const a = STATE.accounts.find(x => x.id === accountId);
    if (!a) return;

    const labels = {
      'not-listed': 'غير معروض',
      'listed':     'معروض للبيع',
      'sold':       'تم البيع',
    };
    const picker = document.createElement('div');
    picker.className = 'status-picker';
    picker.innerHTML = `
      <div class="status-picker-head">اختر الحالة</div>
      ${['not-listed', 'listed', 'sold'].map(s => `
        <button type="button" data-status="${s}" class="${a.status === s ? 'active' : ''}">
          <span class="picker-dot ${s}"></span>
          <span>${labels[s]}</span>
          ${a.status === s ? '<span class="picker-check">✓</span>' : ''}
        </button>
      `).join('')}
    `;
    document.body.appendChild(picker);

    // Position below the anchor
    const rect = anchorEl.getBoundingClientRect();
    const pickerWidth = 200;
    let left = rect.left;
    if (left + pickerWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - pickerWidth - 8);
    }
    picker.style.top  = `${rect.bottom + 6}px`;
    picker.style.left = `${left}px`;

    playSound('open');

    // Click handlers
    picker.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newStatus = btn.dataset.status;
        if (newStatus === a.status) { closeStatusPicker(); return; }
        a.status = newStatus;
        if (newStatus === 'sold' && !a.soldAt) {
          a.soldAt = Date.now();
          freezeSoldPrice(a, STATE.games.find(g => g.id === a.gameId));
        }
        if (newStatus !== 'sold') { a.soldAt = null; a.soldNetEgp = null; }
        saveUserData();
        renderAll();
        playSound('status');
        toast('تم تغيير الحالة إلى: ' + labels[newStatus], 'ok');
        closeStatusPicker();
      });
    });
  }

  function closeStatusPicker() {
    const existing = document.querySelector('.status-picker');
    if (existing) existing.remove();
  }

  // Close picker on outside click / scroll / resize / Escape
  document.addEventListener('click', (e) => {
    if (e.target.closest('.status-picker')) return;
    if (e.target.closest('[data-act="status"]')) return;
    closeStatusPicker();
  });
  document.addEventListener('scroll', closeStatusPicker, true);
  window.addEventListener('resize', closeStatusPicker);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStatusPicker(); });

  // ============= CLOUD (Firebase) =============
  const DATA_COLLECTION = 'userData';     // per-user: games, accounts, boosts (archive), salesLog

  function cloudDb() { return window.db || null; }
  function cloudStorage() { return window.storage || null; }
  function cloudAuth() { return window.auth || null; }

  // ============= Apex Legends Status — Frontend Trigger =============
  // فهرسة/تسجيل الحساب الجديد على apexlegendsstatus.com لازم يحصل من
  // متصفح حقيقي (السيرفر بيعتبر الآلي Cloudflare/باي-pass ويتجاهله).
  // فنبعث طلب مباشر من متصفح المستخدم لصفحة البروفايل (no-cors) قبل ما
  // نسأل سيرفرنا — وده بيفعّل فهرسة الحساب من سيرفرات EA.
  const APEX_STATUS_PLATFORMS = {
    origin: 'PC', // Origin / EA App
    steam: 'PC',  // Steam
    epic: 'PC',   // Epic
    psn: 'PS4',   // PlayStation
    xbl: 'X1',    // Xbox
  };

  function fireApexStatusTrigger(platform, player) {
    if (!platform || !player) return;
    const code = APEX_STATUS_PLATFORMS[platform] || 'PC';
    const url = `https://apexlegendsstatus.com/profile/${code}/${encodeURIComponent(player)}`;
    try {
      // 1) fetch من المتصفح — no-cors: مش بنقرأ الرد لكن الطلب بيتنفذ فعلاً
      fetch(url, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
      // 2) طلب صورة — GET إضافي من نفس المتصفح (بتزيد فرصة الفهرسة)
      const img = new Image();
      img.src = url;
    } catch (e) { /* silent — الـ trigger مفيش مشكلة لو فشل */ }
  }

  // رابط تسجيل الحساب على Apex Legends Status — نفس اللي بيعمله شريط
  // البحث في الموقع نفسه: /profile/{platform}/{player}
  // (ملحوظة: مسار /search/ مش موجود على الموقع — بيرجع 404).
  function apexRegUrl(platform, player) {
    const code = APEX_STATUS_PLATFORMS[platform] || 'PC';
    return `https://apexlegendsstatus.com/profile/${code}/${encodeURIComponent(player)}`;
  }

  // بيعرض صندوق "الحساب جديد": زرار فتح صفحة التسجيل على ALS (تبويب جديد)
  // + زرار "إعادة الجلب" (onRetry). بيشتغل جوه المودال أو جوه الكارت.
  function showApexRegistrationUI(container, platform, player, onRetry) {
    if (!container) return;
    const old = container.querySelector('.als-reg-box');
    if (old) old.remove();

    const url = apexRegUrl(platform, player);
    const box = document.createElement('div');
    box.className = 'als-reg-box';
    box.innerHTML = `
      <div class="als-reg-msg">⚠️ هذا الحساب جديد، اضغط هنا لتسجيله على ALS لأول مرة</div>
      <div class="als-reg-actions">
        <a class="btn-ghost" href="${esc(url)}" target="_blank" rel="noopener">🌐 فتح صفحة التسجيل</a>
        <button type="button" class="btn-primary" data-als-retry>🔄 إعادة الجلب</button>
      </div>`;

    // جوه الكارت نضيف الصندوق بعد شريط المستوى، وخلاف كده (المودال) نضيفه جوه الـ container
    if (container.querySelector('.level-row')) {
      const anchor = container.querySelector('.level-row');
      anchor.after(box);
    } else {
      container.style.display = '';
      container.appendChild(box);
    }

    const retry = box.querySelector('[data-als-retry]');
    if (retry && onRetry) retry.addEventListener('click', onRetry);
  }

  function hideApexRegistrationUI(container) {
    if (!container) return;
    const box = container.querySelector('.als-reg-box');
    if (box) box.remove();
    if (!container.querySelector('.level-row')) container.style.display = 'none';
  }

  // ============= TRACKER.GG — نداء السيرفر الوسيط =============
  // بيتصل بالـ Cloud Function (functions/index.js) اللي بدورها بتتصل
  // بـ Tracker.gg وترجع { level, rank }. مفيش أي اتصال مباشر من هنا
  // لـ Tracker.gg نهائياً (عشان مشكلة CORS + حماية الـ API Key).
  //
  // Two-Step Async + Polling:
  // لو السيرفر رجع 202 أو { indexing: true } أو مستوى فارغ (null/undefined)
  // = الحساب الجديد لسه بيتفهرَس لأول مرة. ممنوع تحديث الخانة بقيمة فارغة!
  // بنعرض حالة انتظار (onIndexing) وبعدين بنعيد طلب نفس الـ Endpoint كل
  // 5 ثواني (بحد أقصى 4 محاولات) لحد ما يرجع 200 ومعاه level حقيقي (رقم).
  async function fetchLevelFromTracker(gameSlug, platform, trackerId, onIndexing, force) {
    const base = window.TRACKER_API_BASE;
    if (!base) {
      throw new Error('لسه ملف tracker-config.js مش متحمّل أو TRACKER_API_BASE فاضي');
    }

    const isApex = gameSlug === 'apex';

    // قبل أول استعلام لسيرفرنا: نطلق Trigger فهرسة مباشر من متصفح المستخدم
    // على apexlegendsstatus.com (الالتفاف على Cloudflare)، ونستنى 3 ثواني
    // عشان الفهرسة تبدأ قبل ما نجيب البيانات من الـ API بتاعنا.
    if (isApex) {
      fireApexStatusTrigger(platform, trackerId);
      await new Promise(r => setTimeout(r, 3000));
    }

    const post = () => fetch(`${base}/getLevel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: gameSlug, platform, trackerId, force: !!force }),
    }).then(async (res) => ({ res, data: await res.json().catch(() => ({})) }));

    // بتقول إذا كانت الاستجابة لسه "بتفهرس" ولا فيها مستوى حقيقي
    const stillIndexing = (res, data) =>
      res.status === 202 ||
      (data && (data.indexing === true || data.level == null));

    const isRealLevel = (data) => {
      if (!data || data.level === null || data.level === undefined) return false;
      const n = Number(data.level);
      return !Number.isNaN(n) && typeof n === 'number';
    };

    let { res, data } = await post();

    // الاستجابة الأولى لسه بتفهرس أو فاضية من المستوى → نبدأ الـ Polling
    if (stillIndexing(res, data)) {
      if (onIndexing) onIndexing(true);

      for (let attempt = 1; attempt <= 4; attempt++) {
        await new Promise(r => setTimeout(r, 5000)); // poll كل 5 ثواني

        // نعيد إطلاق الـ Trigger من المتصفح مع كل محاولة عشان نفضّل
        // منبهين السيرفر إن الحساب لسه مطلوب فهرسته
        if (isApex) fireApexStatusTrigger(platform, trackerId);

        const next = await post();
        res = next.res;
        data = next.data;

        // 1) خطأ صريح من السيرفر (4xx/5xx) → نوقف فوراً ونرمي
        if (res.status >= 400 && !stillIndexing(res, data)) {
          throw new Error(data.error || `فشل الاتصال بالسيرفر الوسيط (HTTP ${res.status})`);
        }

        // 2) وصلنا 200 مع مستوى حقيقي (رقم) → نوقف الـ Polling فوراً ونرجع
        if (res.status === 200 && isRealLevel(data)) break;
      }

      if (onIndexing) onIndexing(false);

      // خلصنا المحاولات ولسه بنفهرس → خطأ واضح (من غير تحديث أي خانة)
      if (stillIndexing(res, data) || !isRealLevel(data)) {
        if (isApex) {
          // حساب Apex جديد لسه مش مسجل على ALS — الواجهة هتقدّم للمستخدم
          // زر/رابط يفتح صفحة التسجيل من متصفحه (الفهرسة بتشتغل من المتصفح)
          const err = new Error('الحساب جديد — سجّله على Apex Legends Status الأول ثم أعد الجلب');
          err.apexNewAccount = true;
          err.apexPlayer = trackerId;
          err.apexPlatform = platform;
          throw err;
        }
        throw new Error('الحساب يحتاج وقتاً أطول للتسجيل، يرجى المحاولة بعد قليل');
      }
    }

    if (!res.ok) {
      throw new Error(data.error || `فشل الاتصال بالسيرفر الوسيط (HTTP ${res.status})`);
    }
    return data; // { ok, level, rank, ... }
  }

  // ============= STORAGE — generic file/image upload =============
  // Uploads any File/Blob to Firebase Storage under `${folder}/${username}/...`
  // and resolves with its public download URL. Reusable anywhere in the site
  // (account images, attachments, etc). Throws if Storage isn't configured.
  async function uploadFileToStorage(file, folder = 'uploads') {
    const storage = cloudStorage();
    if (!storage) throw new Error('Firebase Storage غير مهيأ — تأكد من الاتصال بالإنترنت');
    if (!file) throw new Error('لم يتم اختيار ملف');
    const safeName = String(file.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${folder}/${CURRENT_USER || 'anon'}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
    const ref = storage.ref().child(path);
    const snapshot = await ref.put(file);
    return snapshot.ref.getDownloadURL();
  }
  // Exposed globally so any future part of the site can reuse it easily.
  window.uploadFileToStorage = uploadFileToStorage;

  // ============= CURRENT USER DATA =============
  let CURRENT_USER = null;      // Firebase Auth uid — used as the Firestore/Storage key
  let CURRENT_DISPLAY = null;   // display name shown in the UI (not a security identifier)
  const STATE = {
    games: [],
    accounts: [],
    hours: 0,
    boosts: [],            // active 24h level-boost clouds
    salesLog: [],           // permanent sales history — survives account deletion
    currentView: 'dashboard',
    currentGame: 'all',
  };

  const BOOST_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

  // ============= PRICE / DISPLAY CUSTOMIZATION =============
  const USD_EGP_CACHE_KEY = 'gameover_usd_egp_rate_v1';
  const FALLBACK_USD_EGP_RATE = 49;
  let usdToEgpRate = null;

  // Transient (not persisted) per-card UI state — resets on reload, same as final.html
  let priceCurrencyEGP = new Set(); // account ids currently showing the price in EGP instead of $
  let moneyInfoVisible = new Set(); // account ids with the price-breakdown panel open
  let infoVisible = new Set();      // account ids showing their full raw "معلومات الحساب" text

  function applyUserData(d) {
    STATE.games = Array.isArray(d.games) ? d.games : [];
    STATE.accounts = Array.isArray(d.accounts) ? d.accounts : [];
    STATE.hours = Number(d.hours) || 0;
    STATE.boosts = Array.isArray(d.boosts) ? d.boosts : [];
    STATE.salesLog = Array.isArray(d.salesLog) ? d.salesLog : [];
  }

  async function loadUserData(username) {
    // Try the cloud first — this is what makes data (accounts / archive /
    // sales log) available across different devices/browsers, not just
    // the one that created it.
    const db = cloudDb();
    if (db) {
      try {
        const snap = await db.collection(DATA_COLLECTION).doc(username).get();
        if (snap.exists) {
          const d = snap.data();
          applyUserData(d);
          localStorage.setItem(dataKey(username), JSON.stringify(d));
          ensureAccountSeq();
          return;
        }
      } catch (e) {
        console.warn('تعذّر تحميل البيانات من Firestore، سيتم استخدام النسخة المحلية:', e);
      }
    }
    try {
      const raw = localStorage.getItem(dataKey(username));
      if (raw) {
        const d = JSON.parse(raw);
        applyUserData(d);
        ensureAccountSeq();
        return;
      }
    } catch (e) { console.warn('load error', e); }
    seedFresh();
  }

  // Give every account a permanent, creation-order number (#1, #2, ...).
  // This used to be recomputed from the sorted/filtered list position, which
  // made the numbers jump around alphabetically. Now each account keeps the
  // number it was given when first added, regardless of sorting or filters.
  function ensureAccountSeq() {
    let maxSeq = 0;
    STATE.accounts.forEach(a => { if (a.seq && a.seq > maxSeq) maxSeq = a.seq; });
    let changed = false;
    STATE.accounts.forEach(a => {
      if (!a.seq) {
        maxSeq += 1;
        a.seq = maxSeq;
        changed = true;
      }
    });
    if (changed) saveUserData();
  }

  function saveUserData() {
    if (!CURRENT_USER) return;
    const payload = {
      games: STATE.games,
      accounts: STATE.accounts,
      hours: STATE.hours,
      boosts: STATE.boosts,
      salesLog: STATE.salesLog,
      updatedAt: Date.now(),
    };
    // Instant local cache write (keeps the UI snappy & working offline)
    localStorage.setItem(dataKey(CURRENT_USER), JSON.stringify(payload));
    // Fire-and-forget sync to Firestore (Cloud). Kept non-blocking so no
    // existing call site needs to change; failures just fall back silently
    // to the local cache and retry on the next save.
    const db = cloudDb();
    if (db) {
      db.collection(DATA_COLLECTION).doc(CURRENT_USER).set(payload, { merge: true })
        .catch((e) => console.warn('تعذّر مزامنة البيانات مع Firestore (تم الحفظ محلياً):', e));
    }
  }

  function seedFresh() {
    STATE.games = [];
    STATE.accounts = [];
    STATE.hours = 0;
    STATE.boosts = [];
    STATE.salesLog = [];
    saveUserData();
  }

  // Optional: prefill a few starter games the first time per user
  function seedStarterIfEmpty() {
    if (STATE.games.length > 0) return;
    const opts = [
      { name: 'Apex Legends', color: '#a855f7', icon: 'APX' },
      { name: 'GTA V',        color: '#4ade80', icon: 'GTA' },
      { name: 'EA Sports FC', color: '#c084fc', icon: 'FC' },
      { name: 'Valorant',     color: '#fbbf24', icon: 'VAL' },
    ];
    STATE.games = opts.map(o => ({ id: uid('g'), ...o }));
    saveUserData();
  }

  // ============= FORM SWITCHING =============
  function showForm(name) {
    $$('.auth-form').forEach(f => f.classList.remove('active'));
    const target = $('#form-' + name);
    if (target) target.classList.add('active');
    // Clear errors
    $$('.form-err').forEach(e => e.textContent = '');
    if (name === 'login' && $('#login-err')) {
      const rem = localStorage.getItem(REMEMBER_KEY);
      if (rem) $('#login-user').value = rem;
      setTimeout(() => $('#login-user').focus(), 50);
    }
    if (name === 'signup' && $('#signup-user')) {
      setTimeout(() => $('#signup-user').focus(), 50);
    }
    if (name === 'forgot' && $('#forgot-user')) {
      setTimeout(() => $('#forgot-user').focus(), 50);
    }
  }

  // ============= AUTH ERROR MESSAGES (Arabic) =============
  function authErrorMessage(e) {
    const code = e && e.code;
    switch (code) {
      case 'auth/email-already-in-use': return 'هذا البريد الإلكتروني مسجّل بالفعل، جرّب تسجيل الدخول';
      case 'auth/invalid-email': return 'صيغة البريد الإلكتروني غير صحيحة';
      case 'auth/weak-password': return 'كلمة المرور ضعيفة جداً، اختر كلمة مرور أقوى';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential': return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
      case 'auth/too-many-requests': return 'محاولات كثيرة جداً، حاول مرة أخرى بعد قليل';
      case 'auth/network-request-failed': return 'تعذّر الاتصال بالخادم، تحقق من الإنترنت';
      default: return 'حدث خطأ غير متوقع، حاول مرة أخرى';
    }
  }

  // ============= AUTH HANDLERS =============
  async function handleSignup(e) {
    e.preventDefault();
    const display = $('#signup-user').value.trim();
    const email = $('#signup-email').value.trim();
    const pass = $('#signup-pass').value;
    const pass2 = $('#signup-pass2').value;
    const err = $('#signup-err');
    err.textContent = '';

    if (!/^[A-Za-z0-9_]{3,}$/.test(display)) {
      err.textContent = 'الاسم المعروض يجب أن يكون 3 أحرف على الأقل (حروف إنجليزية، أرقام، _)';
      return;
    }
    if (!email) {
      err.textContent = 'أدخل بريدك الإلكتروني';
      return;
    }
    if (pass.length < 6) {
      err.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
      return;
    }
    if (pass !== pass2) {
      err.textContent = 'كلمتا المرور غير متطابقتين';
      return;
    }

    const auth = cloudAuth();
    if (!auth) { err.textContent = 'تعذّر الاتصال بخدمة الحسابات، تحقق من الإنترنت'; return; }

    const btn = $('#form-signup .auth-btn');
    btn.classList.add('loading');
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: display });

      // Pre-create empty data namespace for the new user
      STATE.games = [];
      STATE.accounts = [];
      STATE.hours = 0;
      STATE.boosts = [];
      CURRENT_USER = cred.user.uid;
      saveUserData();

      await loginUser(cred.user, false);
      toast('تم إنشاء الحساب بنجاح ✓', 'ok');
    } catch (e2) {
      err.textContent = authErrorMessage(e2);
    } finally {
      btn.classList.remove('loading');
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const email = $('#login-user').value.trim();
    const pass = $('#login-pass').value;
    const remember = $('#login-remember').checked;
    const err = $('#login-err');
    err.textContent = '';

    if (!email || !pass) {
      err.textContent = 'أدخل البريد الإلكتروني وكلمة المرور';
      return;
    }
    const auth = cloudAuth();
    if (!auth) { err.textContent = 'تعذّر الاتصال بخدمة الحسابات، تحقق من الإنترنت'; return; }

    const btn = $('#form-login .auth-btn');
    btn.classList.add('loading');
    try {
      // "تذكرني" يتحكم في مدة الجلسة: LOCAL تبقى بعد إغلاق المتصفح،
      // SESSION تنتهي بمجرد إغلاق التبويب. Firebase نفسه يدير التوكن،
      // مفيش أي تخزين يدوي لهوية المستخدم بعد كده.
      await auth.setPersistence(
        remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION
      );
      if (remember) localStorage.setItem(REMEMBER_KEY, email);
      else localStorage.removeItem(REMEMBER_KEY);

      const cred = await auth.signInWithEmailAndPassword(email, pass);
      await loginUser(cred.user, true);
      toast('أهلاً ' + (cred.user.displayName || email) + ' 👋', 'ok');
    } catch (e2) {
      err.textContent = authErrorMessage(e2);
      $('#login-pass').value = '';
      $('#login-pass').focus();
    } finally {
      btn.classList.remove('loading');
    }
  }

  async function loginUser(user, loadData) {
    CURRENT_USER = user.uid;
    CURRENT_DISPLAY = user.displayName || user.email || 'مستخدم';
    if (loadData) await loadUserData(user.uid);
    seedStarterIfEmpty();
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-name-display').textContent = CURRENT_DISPLAY;
    renderAll();
    requestAnimationFrame(moveNavIndicator);
    if (STATE.boosts.length > 0) startBoostTicker();
  }

  function logout() {
    const auth = cloudAuth();
    CURRENT_USER = null;
    CURRENT_DISPLAY = null;
    if (auth) auth.signOut().finally(() => location.reload());
    else location.reload();
  }

  // ============= FORGOT PASSWORD — Firebase-hosted email reset link =============
  async function handleForgot(e) {
    e.preventDefault();
    const email = $('#forgot-user').value.trim();
    const err = $('#forgot-err');
    err.textContent = '';
    if (!email) { err.textContent = 'أدخل بريدك الإلكتروني'; return; }

    const auth = cloudAuth();
    if (!auth) { err.textContent = 'تعذّر الاتصال بخدمة الحسابات، تحقق من الإنترنت'; return; }

    const btn = $('#form-forgot .auth-btn');
    btn.classList.add('loading');
    try {
      await auth.sendPasswordResetEmail(email);
      toast('تم إرسال رابط استرجاع كلمة المرور إلى بريدك ✓', 'ok');
      $('#forgot-user').value = '';
      showForm('login');
    } catch (e2) {
      // Deliberately generic message — do not reveal whether the email exists,
      // to avoid leaking which addresses have accounts on the site.
      if (e2 && e2.code === 'auth/invalid-email') {
        err.textContent = 'صيغة البريد الإلكتروني غير صحيحة';
      } else {
        toast('لو البريد مسجّل لدينا، ستصلك رسالة استرجاع كلمة المرور ✓', 'ok');
        $('#forgot-user').value = '';
        showForm('login');
      }
    } finally {
      btn.classList.remove('loading');
    }
  }

  // ============= SPLASH =============
  function initSplash() {
    const auth = cloudAuth();
    if (!auth) {
      setTimeout(() => {
        $('#splash').classList.add('hidden');
        $('#auth').classList.remove('hidden');
        const rem = localStorage.getItem(REMEMBER_KEY);
        if (rem) $('#login-user').value = rem;
        setTimeout(() => $('#login-user').focus(), 100);
      }, 1300);
      return;
    }
    // Firebase Authentication is the single source of truth for "who is
    // logged in" — it restores the session itself (LOCAL/SESSION
    // persistence set at login time), so we just react to it here.
    let handled = false;
    auth.onAuthStateChanged(async (user) => {
      const reveal = () => $('#splash').classList.add('hidden');
      if (!handled) { handled = true; setTimeout(reveal, 1300); } else { reveal(); }
      if (user) {
        await loginUser(user, true);
      } else {
        setTimeout(() => {
          $('#auth').classList.remove('hidden');
          const rem = localStorage.getItem(REMEMBER_KEY);
          if (rem) $('#login-user').value = rem;
          setTimeout(() => $('#login-user').focus(), 100);
        }, 1300);
      }
    });
  }

  // ============= NAV =============
  function moveNavIndicator() {
    const nav = $('.nav');
    if (!nav) return;
    let indicator = $('#nav-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'nav-indicator';
      indicator.className = 'nav-indicator';
      nav.prepend(indicator);
    }
    const activeBtn = nav.querySelector('.nav-btn.active');
    if (!activeBtn) { indicator.style.opacity = '0'; return; }
    indicator.style.opacity = '1';
    indicator.style.width = activeBtn.offsetWidth + 'px';
    indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
  }

  function switchView(name) {
    STATE.currentView = name;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    moveNavIndicator();
    $$('.view').forEach(v => v.classList.remove('active'));
    const target = $('#view-' + name);
    if (target) target.classList.add('active');
    if (name === 'archive') renderArchiveCards();
    if (name === 'analytics') renderAnalytics();
    if (name === 'sales') renderSalesLog();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.addEventListener('resize', () => moveNavIndicator());

  // ============= RENDER =============
  function renderAll() {
    renderStats();
    renderGamesBar();
    renderCards();
    renderBoosts();
    if (STATE.accounts.some(a => isStarActive(a))) startFavTicker();
  }

  // ============= BOOSTS (24h cloud) =============
  function getAccountIndex(accountId) {
    // Account number = its 1-based position in the currently filtered list
    const filtered = STATE.currentGame === 'all'
      ? STATE.accounts
      : STATE.accounts.filter(a => a.gameId === STATE.currentGame);
    const idx = filtered.findIndex(a => a.id === accountId);
    return idx >= 0 ? idx + 1 : null;
  }

  function getDefaultBoostDurationMs(accountId) {
    const a = STATE.accounts.find(x => x.id === accountId);
    const game = a ? STATE.games.find(g => g.id === a.gameId) : null;
    const hours = getGamePinConfig(game).defaultTimerHours;
    return hours * 60 * 60 * 1000;
  }

  function addBoost(accountId) {
    const a = STATE.accounts.find(x => x.id === accountId);
    if (!a) return;
    // Remove any existing boost for this account (one at a time)
    STATE.boosts = STATE.boosts.filter(b => b.accountId !== accountId);
    // Drop expired ones too
    const now = Date.now();
    STATE.boosts = STATE.boosts.filter(b => now - b.startTime < (b.durationMs || BOOST_DURATION_MS));
    STATE.boosts.push({
      id: uid('b'),
      accountId,
      startTime: now,
      durationMs: getDefaultBoostDurationMs(accountId),
    });
    saveUserData();
    // Timer is now rendered inside each card, so refresh the grid
    renderCards();
  }

  function removeBoost(boostId, animate = true) {
    const el = document.querySelector(`.card-timer[data-boost-id="${CSS.escape(boostId)}"]`);
    if (animate && el) {
      el.classList.add('expired');
      setTimeout(() => {
        STATE.boosts = STATE.boosts.filter(b => b.id !== boostId);
        saveUserData();
        renderCards();
      }, 600);
    } else {
      STATE.boosts = STATE.boosts.filter(b => b.id !== boostId);
      saveUserData();
      renderCards();
    }
  }

  function cleanupExpiredBoosts() {
    const now = Date.now();
    const expired = STATE.boosts.filter(b => now - b.startTime >= (b.durationMs || BOOST_DURATION_MS));
    expired.forEach(b => removeBoost(b.id, true));
  }

  function formatRemaining(ms) {
    if (ms <= 0) return '00:00:00';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  // Format a timestamp as a 12-hour wall-clock time with an Arabic AM/PM marker (e.g. "11:58:30 م")
  function formatTimeOfDay(timestamp) {
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    let hours = d.getHours();
    const period = hours >= 12 ? 'م' : 'ص';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${pad(hours)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${period}`;
  }

  // Arabic month names for the timer date label
  const ARABIC_MONTHS = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];

  // Render the in-card 24h timer for a given boost
  function renderCardTimerHTML(boost) {
    const now = Date.now();
    const duration = boost.durationMs || BOOST_DURATION_MS;
    const elapsed = now - boost.startTime;
    const remaining = Math.max(0, duration - elapsed);
    const endTimestamp = boost.startTime + duration;
    const endDate = new Date(endTimestamp);
    const dateStr = `${endDate.getDate()} ${ARABIC_MONTHS[endDate.getMonth()]}`;
    // Progress fill grows as the countdown drains toward zero
    const progress = Math.min(1, Math.max(0, elapsed / duration));
    return `
      <div class="card-timer" data-boost-id="${esc(boost.id)}" data-account-id="${esc(boost.accountId)}" style="--progress: ${(progress * 100).toFixed(2)}%">
        <span class="card-timer-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path d="M19.5 14.5c1.4 0 2.5-1.1 2.5-2.5 0-1.3-1-2.4-2.3-2.5-.4-2.7-2.8-4.8-5.6-4.8-2.2 0-4.1 1.3-5 3.1-.3-.1-.7-.1-1-.1-1.9 0-3.5 1.5-3.7 3.4-1.3.3-2.3 1.5-2.3 2.9 0 1.6 1.3 3 3 3h14.4z" fill="currentColor"/>
          </svg>
        </span>
        <span class="card-timer-text">
          <span class="timer-label">منذ رفع جديد بمد</span>
          <span class="timer-time" data-card-timer-elapsed>${formatRemaining(remaining)}</span>
          <span class="timer-break"></span>
          <span class="timer-label">موعد التحقق:</span>
          <span class="timer-time" data-card-timer-end>${formatTimeOfDay(endTimestamp)}</span>
          <span class="timer-sep">-</span>
          <span class="timer-date" data-card-timer-date>${dateStr}</span>
        </span>
        <span class="card-timer-hint">دبل كليك للتعديل</span>
      </div>
    `;
  }

  // Backward-compatible: the old "boosts container" is gone, the timer is now
  // rendered inside each card. Keep this as a thin wrapper that triggers a
  // full re-render so any caller still works.
  function renderBoosts() {
    cleanupExpiredBoosts();
    renderCards();
  }

  function updateBoostDisplays() {
    const now = Date.now();
    STATE.boosts.forEach(b => {
      const el = document.querySelector(`.card-timer[data-boost-id="${CSS.escape(b.id)}"]`);
      if (!el) return;
      const duration = b.durationMs || BOOST_DURATION_MS;
      const elapsed = now - b.startTime;
      const remaining = Math.max(0, duration - elapsed);
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      el.style.setProperty('--progress', (progress * 100).toFixed(2) + '%');
      const elapsedEl = el.querySelector('[data-card-timer-elapsed]');
      const endEl = el.querySelector('[data-card-timer-end]');
      if (elapsedEl) elapsedEl.textContent = formatRemaining(remaining);
      if (endEl) endEl.textContent = formatTimeOfDay(b.startTime + duration);
    });
  }

  // Drive the in-card countdown + auto-cleanup once per second
  let boostTicker = null;
  function startBoostTicker() {
    stopBoostTicker();
    boostTicker = setInterval(() => {
      if (STATE.boosts.length === 0) {
        stopBoostTicker();
        return;
      }
      updateBoostDisplays();
      cleanupExpiredBoosts();
    }, 1000);
  }
  function stopBoostTicker() {
    if (boostTicker) { clearInterval(boostTicker); boostTicker = null; }
  }

  // ===== Double-click to edit the timer =====
  function startBoostEdit(boostId) {
    const boost = STATE.boosts.find(b => b.id === boostId);
    if (!boost) return;
    const el = document.querySelector(`.card-timer[data-boost-id="${CSS.escape(boostId)}"]`);
    if (!el || el.classList.contains('editing')) return;

    // Stop the ticker while editing so it can't clobber the form mid-edit
    stopBoostTicker();

    const now = Date.now();
    const duration = boost.durationMs || BOOST_DURATION_MS;
    const remainingMs = Math.max(0, duration - (now - boost.startTime));
    const hVal = Math.floor(remainingMs / 3600000);
    const mVal = Math.floor((remainingMs % 3600000) / 60000);

    el.classList.add('editing');
    const originalHTML = el.innerHTML;
    el.innerHTML = `
      <div class="timer-edit-form">
        <div class="timer-edit-label">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm.75 10.25V6.5h-1.5v6.5l5 3 .75-1.23z" fill="currentColor"/>
          </svg>
          عدّل الوقت المتبقي يدوياً
        </div>
        <div class="timer-edit-row">
          <div class="timer-edit-field">
            <input type="number" class="timer-edit-input" data-edit-hours min="0" value="${hVal}" />
            <span>ساعة</span>
          </div>
          <div class="timer-edit-field">
            <input type="number" class="timer-edit-input" data-edit-minutes min="0" max="59" value="${mVal}" />
            <span>دقيقة</span>
          </div>
        </div>
        <div class="timer-edit-actions">
          <button type="button" class="timer-edit-cancel" data-edit-cancel>إلغاء ✕</button>
          <button type="button" class="timer-edit-save" data-edit-save>حفظ 💾</button>
        </div>
      </div>
    `;

    const hoursInput = el.querySelector('[data-edit-hours]');
    const minutesInput = el.querySelector('[data-edit-minutes]');
    const saveBtn = el.querySelector('[data-edit-save]');
    const cancelBtn = el.querySelector('[data-edit-cancel]');
    hoursInput.focus();
    hoursInput.select();

    let committed = false;
    const restartTicker = () => { if (STATE.boosts.length > 0) startBoostTicker(); };
    const cleanup = () => {
      el.classList.remove('editing');
      el.innerHTML = originalHTML;
      restartTicker();
    };
    const commit = () => {
      if (committed) return;
      committed = true;
      let h = Math.floor(+hoursInput.value);
      let m = Math.floor(+minutesInput.value);
      if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) {
        playSound('error');
        toast('أدخل أرقام صحيحة للساعات والدقائق', 'err');
        cleanup();
        return;
      }
      m = Math.min(59, m);
      const newMs = (h * 3600 + m * 60) * 1000;
      if (newMs === 0) {
        cleanup();
        removeBoost(boostId, true);
        playSound('click');
        return;
      }
      // ما تتطرحش من 24 ساعة — اللي بيتكتب هو اللي بيتحط كوقت متبقي زي ما هو بالظبط
      boost.startTime = now;
      boost.durationMs = newMs;
      saveUserData();
      cleanup();
      updateBoostDisplays();
      playSound('click');
      toast('تم تعديل وقت التايمر ✓', 'ok');
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      cleanup();
    };

    saveBtn.addEventListener('click', commit);
    cancelBtn.addEventListener('click', cancel);
    [hoursInput, minutesInput].forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      });
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('dblclick', (e) => e.stopPropagation());
    });
    el.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  // ============= FAVORITES (count-up "time worked on this account") =============
  // Each starred account gets its own stopwatch that counts UP from the
  // moment it was starred. Because it's derived from a stored timestamp
  // (starredAt) rather than an in-memory counter, it keeps increasing
  // correctly even after closing the browser/tab and coming back later.
  // Renders the little up-counting stopwatch badge shown right on a starred
  // card (next to the ★). Same data/logic as before, just inline now instead
  // of a separate favorites page.
  // Format a Date as "DD/MM — HH:MM AM/PM" (12-hour clock, matches the
  // "شغال من ..." label above the star timer).
  function formatDateTime12(d) {
    const pad = (n) => String(n).padStart(2, '0');
    let hours = d.getHours();
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} — ${pad(hours)}:${pad(d.getMinutes())} ${period}`;
  }

  // Total elapsed time for an account's star timer, taking pause/resume into
  // account: accumulated time from any previously-finished running segments
  // + the live segment currently running (if any). Kept 100% derived from
  // stored fields (starAccumulatedMs / starRunStartTime), which are saved on
  // every change via saveUserData(), so nothing is ever lost on refresh,
  // logout, or closing the tab.
  // Whether the star should currently show as "on" (gold highlight on the
  // card + filled ★ + timer badge visible). This is true only while the
  // timer is actively running — pausing it hides the highlight and the
  // timer badge completely, without losing the banked time.
  function isStarActive(a) {
    return !!(a && a.starred && a.starTimerRunning !== false);
  }

  function getStarElapsedMs(a) {
    if (!a || !a.starred) return 0;
    const now = Date.now();
    const accumulated = Number(a.starAccumulatedMs) || 0;
    // Backward compatibility with older saved accounts that only had the
    // simple starred/starredAt pair (no pause state yet) — treat them as
    // "running since starredAt".
    const running = a.starTimerRunning !== false;
    if (running) {
      const start = a.starRunStartTime || a.starredAt || now;
      return accumulated + Math.max(0, now - start);
    }
    return accumulated;
  }

  // Only ever called while the timer is actively running (isStarActive) —
  // when paused, the badge isn't rendered at all, per the card template.
  function renderCardStarTimerHTML(a) {
    const elapsed = getStarElapsedMs(a);
    const since = new Date(a.starredAt || Date.now());
    const sinceStr = formatDateTime12(since);
    return `
      <div class="card-star-timer" data-star-timer data-account-id="${esc(a.id)}">
        <span class="card-star-timer-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm.75 10.25V6.5h-1.5v6.5l5 3 .75-1.23z" fill="currentColor"/>
          </svg>
        </span>
        <span class="card-star-timer-time" data-star-elapsed>${formatRemaining(elapsed)}</span>
        <span class="card-star-timer-since">شغال من ${sinceStr}</span>
      </div>
    `;
  }

  let favTicker = null;
  function startFavTicker() {
    if (favTicker) return;
    favTicker = setInterval(() => {
      const now = Date.now();
      document.querySelectorAll('[data-star-timer]').forEach(el => {
        const a = STATE.accounts.find(x => x.id === el.dataset.accountId);
        if (!a || !a.starred) return;
        const elapsed = getStarElapsedMs(a);
        const timeEl = el.querySelector('[data-star-elapsed]');
        if (timeEl) timeEl.textContent = formatRemaining(elapsed);
      });
    }, 1000);
  }
  function stopFavTicker() {
    if (favTicker) { clearInterval(favTicker); favTicker = null; }
  }

  function renderStats() {
    const total = STATE.accounts.length;
    const listed = STATE.accounts.filter(a => a.status === 'listed').length;
    const sold = STATE.accounts.filter(a => a.status === 'sold').length;
    const revenue = STATE.accounts
      .filter(a => a.status === 'sold')
      .reduce((s, a) => s + getAccountProfitEgp(a, STATE.games.find(g => g.id === a.gameId)), 0);
    countUp($('#stat-total'), total);
    countUp($('#stat-listed'), listed);
    countUp($('#stat-sold'), sold);
    countUp($('#stat-revenue'), revenue, { suffix: ' ج.م', isCurrency: true });
  }

  function renderGamesBar() {
    const list = $('#games-list');
    const allTab = `
      <button class="game-tab ${STATE.currentGame === 'all' ? 'active' : ''}" data-game="all">
        <span class="game-dot" style="background:#a855f7"></span>
        كل الألعاب
      </button>`;
    const tabs = STATE.games.map(g => `
      <button class="game-tab ${STATE.currentGame === g.id ? 'active' : ''}" data-game="${esc(g.id)}">
        <span class="game-dot" style="background:${esc(g.color)}"></span>
        ${esc(g.name)}
      </button>
    `).join('');
    list.innerHTML = allTab + tabs;
    list.querySelectorAll('.game-tab').forEach(b => {
      b.addEventListener('click', () => {
        STATE.currentGame = b.dataset.game;
        renderGamesBar();
        renderCards();
      });
      // "كل الألعاب" is a virtual tab, not a real game — no delete menu for it
      if (b.dataset.game !== 'all') {
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openGameContextMenu(b.dataset.game, e.clientX, e.clientY);
        });
      }
    });
  }

  // ============= RIGHT-CLICK MENU — DELETE GAME =============
  function closeGameContextMenu() {
    const existing = document.querySelector('.game-context-menu');
    if (existing) existing.remove();
  }

  function openGameContextMenu(gameId, x, y) {
    closeGameContextMenu();
    closeStatusPicker();

    const menu = document.createElement('div');
    menu.className = 'game-context-menu';
    menu.innerHTML = `
      <button type="button" class="game-context-menu-item danger" data-act="delete-game">
        <span aria-hidden="true">🗑️</span> حذف اللعبة
      </button>
    `;
    document.body.appendChild(menu);

    // Position at the cursor, kept fully on-screen
    const menuW = menu.offsetWidth || 170;
    const menuH = menu.offsetHeight || 44;
    const left = Math.min(x, window.innerWidth - menuW - 8);
    const top = Math.min(y, window.innerHeight - menuH - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;

    playSound('open');

    menu.querySelector('[data-act="delete-game"]').addEventListener('click', (e) => {
      e.stopPropagation();
      closeGameContextMenu();
      deleteGame(gameId);
    });
  }

  // Close the game context menu on outside click / scroll / resize / Escape
  // (same pattern used for the status picker above).
  document.addEventListener('click', (e) => {
    if (e.target.closest('.game-context-menu')) return;
    closeGameContextMenu();
  });
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.game-tab')) return; // that click opens its own menu
    closeGameContextMenu();
  });
  document.addEventListener('scroll', closeGameContextMenu, true);
  window.addEventListener('resize', closeGameContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGameContextMenu(); });

  function deleteGame(gameId) {
    const g = STATE.games.find(x => x.id === gameId);
    if (!g) return;

    const relatedAccounts = STATE.accounts.filter(a => a.gameId === gameId);
    const confirmMsg = relatedAccounts.length > 0
      ? `حذف لعبة "${g.name}"؟ هيتم حذف ${relatedAccounts.length} حساب مرتبط بيها نهائياً (من لوحة التحكم والأرشيف). سجل المبيعات القديم هيفضل زي ما هو.`
      : `حذف لعبة "${g.name}"؟`;
    if (!confirm(confirmMsg)) return;

    const removedAccountIds = new Set(relatedAccounts.map(a => a.id));
    // Remove the accounts that belong to this game...
    STATE.accounts = STATE.accounts.filter(a => a.gameId !== gameId);
    // ...and any active archive/cloud timers they had.
    STATE.boosts = STATE.boosts.filter(b => !removedAccountIds.has(b.accountId));
    // Finally remove the game tab itself.
    STATE.games = STATE.games.filter(x => x.id !== gameId);
    // If that was the currently-selected tab, fall back to "كل الألعاب"
    if (STATE.currentGame === gameId) STATE.currentGame = 'all';

    saveUserData();
    renderAll();
    playSound('error');
    toast(`تم حذف اللعبة "${g.name}" ✓`, 'ok');
  }

  // ---- "تخصيص شكل العرض" per-game config: extra fields + default price/percentage ----
  function getGamePinConfig(game) {
    const cfg = (game && game.pinConfig) || {};
    return {
      rows: Array.isArray(cfg.rows) ? cfg.rows : [],
      defaultPrice: (cfg.defaultPrice !== undefined && cfg.defaultPrice !== null && cfg.defaultPrice !== '') ? Number(cfg.defaultPrice) : 150,
      sitePercentage: (cfg.sitePercentage !== undefined && cfg.sitePercentage !== null && cfg.sitePercentage !== '') ? Number(cfg.sitePercentage) : 0,
      nameKey: (typeof cfg.nameKey === 'string') ? cfg.nameKey : '',
      defaultTimerHours: (cfg.defaultTimerHours !== undefined && cfg.defaultTimerHours !== null && cfg.defaultTimerHours !== '' && !isNaN(cfg.defaultTimerHours) && Number(cfg.defaultTimerHours) > 0) ? Number(cfg.defaultTimerHours) : 24,
    };
  }

  // Reads a line like "Username: marwan123" out of the free-text "معلومات الحساب" box
  function extractInfoField(text, fieldName) {
    if (!text || !fieldName) return '';
    const escaped = String(fieldName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^[ \\t]*' + escaped + '[ \\t]*:[ \\t]*(.*)$', 'im');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  }

  function getAccountPriceUsd(a, game) {
    if (a.priceUsd !== undefined && a.priceUsd !== null && a.priceUsd !== '' && !isNaN(a.priceUsd)) return Number(a.priceUsd);
    return getGamePinConfig(game).defaultPrice;
  }
  function getAccountSitePercentage(a, game) {
    if (a.sitePercentage !== undefined && a.sitePercentage !== null && a.sitePercentage !== '' && !isNaN(a.sitePercentage)) return Number(a.sitePercentage);
    return getGamePinConfig(game).sitePercentage;
  }
  function getAccountNetUsd(a, game) {
    const price = getAccountPriceUsd(a, game);
    const cut = getAccountSitePercentage(a, game);
    return price - (price * cut / 100);
  }
  function getAccountEGP(a, game) {
    const rate = usdToEgpRate || FALLBACK_USD_EGP_RATE;
    return getAccountNetUsd(a, game) * rate;
  }

  // السعر (priceUsd) هو الأساس اللي بيتحسب عليه الربح دلوقتي. لو الحساب اتباع، بنجمّد
  // السعر وقتها عشان الربح المسجل يفضل ثابت حتى لو السعر أو سعر الصرف اتغير بعد كده.
  function getAccountProfitEgp(a, game) {
    if (a.soldNetEgp !== undefined && a.soldNetEgp !== null && !isNaN(a.soldNetEgp)) return Number(a.soldNetEgp);
    return getAccountEGP(a, game);
  }
  function freezeSoldPrice(a, game) {
    a.soldNetEgp = getAccountEGP(a, game);
    addSalesLogEntry(a, game);
  }

  // Snapshot the sale into a permanent, independent record so it survives
  // even if the original account is edited or deleted later.
  function addSalesLogEntry(a, game) {
    STATE.salesLog.push({
      id: uid('sl'),
      accountId: a.id,
      accountName: a.name,
      gameName: game ? game.name : '—',
      soldAt: a.soldAt || Date.now(),
      profitEgp: a.soldNetEgp,
    });
  }

  function deleteSalesLogEntry(logId) {
    if (!confirm('حذف هذا السطر من سجل المبيعات؟')) return;
    STATE.salesLog = STATE.salesLog.filter(l => l.id !== logId);
    saveUserData();
    renderSalesLog();
    playSound('error');
    toast('تم حذف السطر من السجل', 'ok');
  }

  // ---- Live USD → EGP exchange rate (auto-refreshes) ----
  async function loadUsdToEgpRate() {
    try {
      const cached = JSON.parse(localStorage.getItem(USD_EGP_CACHE_KEY) || 'null');
      if (cached && cached.rate) usdToEgpRate = cached.rate;
    } catch (e) { /* ignore */ }
    updateUsdRateUI();
    if (usdToEgpRate) renderCards();

    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      const data = await res.json();
      if (data && data.rates && data.rates.EGP) {
        usdToEgpRate = data.rates.EGP;
        localStorage.setItem(USD_EGP_CACHE_KEY, JSON.stringify({ rate: usdToEgpRate, ts: Date.now() }));
      }
    } catch (e) {
      if (!usdToEgpRate) usdToEgpRate = FALLBACK_USD_EGP_RATE;
    }
    updateUsdRateUI();
    renderCards();
  }
  function updateUsdRateUI() {
    const el = $('#usd-rate-info');
    if (el && usdToEgpRate) el.textContent = `💱 1$ = ${usdToEgpRate.toFixed(2)} ج.م (يتحدث تلقائياً)`;
  }

  function togglePriceCurrency(id, e) {
    if (e) e.stopPropagation();
    if (priceCurrencyEGP.has(id)) priceCurrencyEGP.delete(id); else priceCurrencyEGP.add(id);
    playSound('click');
    renderCards();
  }
  function toggleMoneyInfo(id, e) {
    if (e) e.stopPropagation();
    if (moneyInfoVisible.has(id)) moneyInfoVisible.delete(id); else moneyInfoVisible.add(id);
    playSound('click');
    renderCards();
  }
  function toggleInfoVisible(id, e) {
    if (e) e.stopPropagation();
    if (infoVisible.has(id)) infoVisible.delete(id); else infoVisible.add(id);
    playSound('click');
    renderCards();
  }

  function renderCards() {
    const all = STATE.currentGame === 'all'
      ? STATE.accounts
      : STATE.accounts.filter(a => a.gameId === STATE.currentGame);
    // Accounts with an active countdown timer live in the Archive tab instead
    // of the dashboard, until their timer hits zero.
    const dashboardList = all.filter(a => !STATE.boosts.some(b => b.accountId === a.id));
    renderCardsGrid($('#cards-grid'), dashboardList, 'لا توجد حسابات هنا', 'أضف حساب جديد أو غيّر التبويب لتبدأ');
    renderArchiveCards();
  }

  // Cards currently "في الأرشيف" — accounts with an active countdown timer
  // (started by pressing the ☁️ cloud button). They return automatically to
  // the dashboard, with the exact same number, the instant the timer hits 00:00:00.
  function renderArchiveCards() {
    const archiveGrid = $('#archive-cards-grid');
    if (!archiveGrid) return;
    const archived = STATE.accounts.filter(a => STATE.boosts.some(b => b.accountId === a.id));
    renderCardsGrid(archiveGrid, archived, 'الأرشيف فاضي دلوقتي', 'الحسابات اللي بتتحقق بعد الرفع بالسحابة ☁️ هتظهر هنا لحد ما التايمر يخلّص');
  }

  function renderCardsGrid(grid, filtered, emptyTitle, emptySub) {
    if (!grid) return;
    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">▦</div>
          <div style="font-size:1.05rem;margin-bottom:0.4rem">${emptyTitle}</div>
          <div style="font-size:0.85rem">${emptySub}</div>
        </div>`;
      return;
    }

    filtered.sort((a, b) => {
      if (isStarActive(a) !== isStarActive(b)) return isStarActive(b) ? 1 : -1;
      if (a.seq && b.seq) return a.seq - b.seq;
      return a.name.localeCompare(b.name);
    });

    grid.innerHTML = filtered.map((a, i) => {
      const game = STATE.games.find(g => g.id === a.gameId);
      const profit = getAccountProfitEgp(a, game);
      const statusText = a.status === 'listed' ? 'معروض للبيع' : a.status === 'sold' ? 'تم البيع' : 'غير معروض';
      const num = a.seq || (i + 1);
      const activeBoost = STATE.boosts.find(b => b.accountId === a.id);
      const timerHTML = activeBoost ? renderCardTimerHTML(activeBoost) : '';

      // ---- Rank / price (from "تخصيص شكل العرض" + "إنشاء تفاصيل الحساب") ----
      const showEgp = priceCurrencyEGP.has(a.id);
      const netUsd = getAccountNetUsd(a, game);
      const egp = getAccountEGP(a, game);
      const priceToggleLabel = showEgp ? `💰 ${Math.round(egp)}ج` : `💵 $${netUsd.toFixed(2).replace(/\.00$/, '')}`;
      const isMoneyInfoOpen = moneyInfoVisible.has(a.id);
      const moneyInfoPanelHTML = isMoneyInfoOpen ? `
        <div class="money-info-panel">
          <div class="money-info-row"><span>السعر قبل الخصم</span><span class="val">💵 $${getAccountPriceUsd(a, game)}</span></div>
          <div class="money-info-row"><span>نسبة الموقع</span><span class="val">📊 ${getAccountSitePercentage(a, game)}%</span></div>
          <div class="money-info-row"><span>السعر بعد الخصم (دولار)</span><span class="val">💵 $${netUsd.toFixed(2).replace(/\.00$/, '')}</span></div>
          <div class="money-info-row"><span>السعر بعد الخصم (جنيه)</span><span class="val">💰 ${Math.round(egp)}ج</span></div>
        </div>` : '';

      // ---- Extra custom fields configured for this game, pulled out of the free-text info ----
      const pinCfg = getGamePinConfig(game);
      const pinRows = pinCfg.rows;
      const autoName = pinCfg.nameKey ? extractInfoField(a.info || '', pinCfg.nameKey) : '';
      const displayName = autoName || a.name;
      const extraFieldsHTML = pinRows.length ? `
        <div class="pass-row">
          ${pinRows.map(label => {
            const val = extractInfoField(a.info || '', label);
            return `
              <div class="cred">
                <div class="cred-wrap">
                  <span class="cred-label">${esc(label)}</span>
                  <span class="cred-val cred-clickable" data-copy-text="${esc(val)}" title="اضغط للنسخ">${esc(val || '—')}</span>
                </div>
              </div>`;
          }).join('')}
        </div>` : '';

      const isInfoOpen = infoVisible.has(a.id);
      const infoToggleHTML = a.info ? `
        <button type="button" class="info-toggle-btn" data-act="info-toggle" data-id="${esc(a.id)}">${isInfoOpen ? '🙈 إخفاء تفاصيل الحساب' : '👀 عرض تفاصيل الحساب'}</button>
        ${isInfoOpen ? `<div class="acc-info cred-clickable" data-copy-text="${esc(a.info)}" title="اضغط تنسخ">${esc(a.info)}</div>` : ''}
      ` : '';

      return `
        <div class="card ${isStarActive(a) ? 'starred' : ''}" style="animation-delay:${i * 0.03}s">
          ${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="" class="card-image" />` : ''}
          <div class="card-head">
            <div>
              <div class="card-title-row">
                <span class="card-num" title="رقم الحساب">#${num}</span>
                <div class="card-title">${esc(displayName)}</div>
              </div>
              <div class="card-game">
                <span class="game-dot" style="background:${esc(game?.color || '#a855f7')}"></span>
                ${esc(game?.name || '—')}
              </div>
            </div>
            <div class="card-head-actions">
              <button class="star-btn ${isStarActive(a) ? 'on' : ''}" data-act="star" data-id="${esc(a.id)}" title="تمييز + تايمر متابعة خاص">
                ${isStarActive(a) ? '★' : '☆'}
              </button>
              <button class="boost-btn-top ${activeBoost ? 'active' : ''}" data-act="boost" data-id="${esc(a.id)}" title="رفع مستوى +1 + تايمر 24 ساعة">
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                  <path d="M19.5 14.5c1.4 0 2.5-1.1 2.5-2.5 0-1.3-1-2.4-2.3-2.5-.4-2.7-2.8-4.8-5.6-4.8-2.2 0-4.1 1.3-5 3.1-.3-.1-.7-.1-1-.1-1.9 0-3.5 1.5-3.7 3.4-1.3.3-2.3 1.5-2.3 2.9 0 1.6 1.3 3 3 3h14.4z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>
          ${isStarActive(a) ? renderCardStarTimerHTML(a) : ''}
          <button type="button" class="status status-clickable ${a.status}" data-act="status" data-id="${esc(a.id)}" title="اضغط لتغيير الحالة">
            <span class="dot"></span> ${statusText}
            <span class="status-arrow" aria-hidden="true">▾</span>
          </button>

          <div class="acc-meta-row">
            ${a.rank ? `<span class="meta-badge rank-badge">🎖️ ${esc(a.rank)}</span>` : ''}
            <span class="meta-badge price-badge" data-act="price-toggle" data-id="${esc(a.id)}" title="دوس لتحويل العملة">${priceToggleLabel}</span>
            <button type="button" class="meta-badge money-info-btn ${isMoneyInfoOpen ? 'active' : ''}" data-act="money-info" data-id="${esc(a.id)}" title="تفاصيل السعر">📊</button>
          </div>
          ${moneyInfoPanelHTML}

          ${extraFieldsHTML}

          <div class="level-row">
            <div class="level-info">
              <span>المستوى <strong>${a.level}</strong> / ${a.maxLevel || 100}</span>
              <div class="level-controls">
                ${(() => { const g = getTrackerGameConfig(game); return g && a.trackerId && (a.platform || g.slug === 'valorant') ? `<button class="lvl-btn" data-act="refresh-level" data-id="${esc(a.id)}" title="تحديث المستوى من Tracker.gg">🔄</button>` : ''; })()}
                <button class="lvl-btn" data-act="lvl" data-id="${esc(a.id)}" data-delta="-1" title="إنزال مستوى">−</button>
                <button class="lvl-btn" data-act="lvl" data-id="${esc(a.id)}" data-delta="1" title="رفع مستوى">+</button>
              </div>
            </div>
            <div class="level-bar">
              <div class="level-fill" style="width:${Math.min(100, (a.level / (a.maxLevel || 100)) * 100)}%"></div>
            </div>
          </div>

          <div class="card-actions">
            <button class="act-btn" data-act="edit" data-id="${esc(a.id)}">تعديل</button>
            <button class="act-btn del" data-act="del" data-id="${esc(a.id)}">حذف</button>
          </div>

          ${timerHTML}

          ${infoToggleHTML}
          ${a.notes ? `<div class="acc-notes">📌 <b>ملاحظة:</b> ${esc(a.notes)}</div>` : ''}
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', onCardAction);
    });

    // Make credential values clickable to copy
    grid.querySelectorAll('.cred-clickable').forEach(el => {
      el.addEventListener('click', () => {
        const text = el.dataset.copyText || el.textContent;
        copyText(text, el);
      });
    });

    // Double-click the in-card timer to edit its remaining time
    grid.querySelectorAll('.card-timer').forEach(timerEl => {
      timerEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const boostId = timerEl.dataset.boostId;
        if (boostId) startBoostEdit(boostId);
      });
    });

    // Keep the per-second ticker in sync with the new in-card timers
    if (STATE.boosts.length > 0) startBoostTicker();
    if (STATE.accounts.some(x => x.starred)) startFavTicker(); else stopFavTicker();
  }

  // ============= CARD ACTIONS =============
  function onCardAction(e) {
    const btn = e.currentTarget;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (act === 'star') toggleStar(id);
    else if (act === 'copy') copyText(btn.dataset.text, btn);
    else if (act === 'lvl') changeLevel(id, +btn.dataset.delta, btn);
    else if (act === 'refresh-level') refreshAccountLevelFromTracker(id, btn);
    else if (act === 'status') { e.stopPropagation(); openStatusPicker(id, btn); }
    else if (act === 'boost') handleBoost(id, btn);
    else if (act === 'edit') openAccountModal(id);
    else if (act === 'del') deleteAccount(id);
    else if (act === 'price-toggle') togglePriceCurrency(id, e);
    else if (act === 'money-info') toggleMoneyInfo(id, e);
    else if (act === 'info-toggle') toggleInfoVisible(id, e);
  }

  function handleBoost(id, btn) {
    const a = STATE.accounts.find(x => x.id === id);
    if (!a) return;

    // The card is currently sitting in "الأرشيف" (it already has a running
    // 24h cloud timer). Pressing the same green cloud button again means:
    // cancel the countdown right now and send the card straight back to the
    // dashboard, keeping its original number (#seq is never touched).
    const existingBoost = STATE.boosts.find(b => b.accountId === id);
    if (existingBoost) {
      removeBoost(existingBoost.id, true);
      if (btn) {
        btn.classList.remove('pressed');
        void btn.offsetWidth;
        btn.classList.add('pressed');
        setTimeout(() => btn.classList.remove('pressed'), 350);
      }
      playSound('click');
      toast('تم إلغاء الأرشفة، رجع الحساب للوحة التحكم ↩️', 'ok');
      return;
    }

    const max = a.maxLevel || 100;
    if (a.level >= max) {
      playSound('error');
      toast('المستوى وصل للحد الأقصى بالفعل', 'err');
      return;
    }
    // 1) Level up via existing path so the bump animation plays
    changeLevel(id, +1, null);
    // 2) Add the 24h cloud for this account
    addBoost(id);
    // 3) Make sure the ticker is running
    if (STATE.boosts.length > 0) startBoostTicker();
    // 4) Visual feedback on the button itself
    if (btn) {
      btn.classList.remove('pressed');
      void btn.offsetWidth;
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 350);
    }
    toast('تم رفع المستوى +1 وفتح تايمر 24 ساعة ⛅', 'ok');
  }

  // The ⭐ button now cycles through three states on the same account:
  //   1st press → start   (highlight + timer badge appear, counts up from 00:00:00)
  //   2nd press → pause    (highlight + timer badge disappear; the elapsed
  //                         time is banked internally, nothing is lost)
  //   3rd press → resume   (highlight + timer badge reappear, continuing
  //                         from exactly the same point)
  //   ...and so on, pause/resume forever.
  // Everything is stored on the account itself (starAccumulatedMs /
  // starRunStartTime), so saveUserData() persists it to localStorage +
  // Firestore automatically — the running time survives refresh, logout,
  // and reopening the app on another device.
  function toggleStar(id) {
    const a = STATE.accounts.find(x => x.id === id);
    if (!a) return;
    const now = Date.now();

    if (!a.starred) {
      // Not started yet → start
      a.starred = true;
      a.starredAt = now;
      a.starAccumulatedMs = 0;
      a.starRunStartTime = now;
      a.starTimerRunning = true;
    } else if (a.starTimerRunning !== false) {
      // Currently running → pause (bank the elapsed time so far)
      const start = a.starRunStartTime || a.starredAt || now;
      a.starAccumulatedMs = (Number(a.starAccumulatedMs) || 0) + Math.max(0, now - start);
      a.starRunStartTime = null;
      a.starTimerRunning = false;
    } else {
      // Currently paused → resume from where it left off
      a.starRunStartTime = now;
      a.starTimerRunning = true;
    }

    saveUserData();
    playSound('star');
    renderCards();
    if (STATE.accounts.some(x => x.starred)) startFavTicker(); else stopFavTicker();
  }

  function changeLevel(id, delta, srcBtn) {
    const a = STATE.accounts.find(x => x.id === id);
    if (!a) return;
    const before = a.level;
    a.level = Math.max(0, Math.min(a.maxLevel || 100, a.level + delta));
    if (a.level === before) {
      // At the cap, play a soft error
      playSound('error');
      return;
    }
    saveUserData();
    playSound(delta > 0 ? 'level-up' : 'level-down');
    renderCards();
    // Bump animation on the new level value
    requestAnimationFrame(() => {
      const card = document.querySelector(`.card [data-act="lvl"][data-id="${CSS.escape(id)}"]`)?.closest('.card');
      const lvlEl = card?.querySelector('.level-info strong');
      if (lvlEl) {
        lvlEl.classList.remove('bump', 'up', 'down');
        void lvlEl.offsetWidth; // restart anim
        lvlEl.classList.add('bump', delta > 0 ? 'up' : 'down');
      }
    });
  }

  // ============= TRACKER.GG — تحديث سريع من كارت الحساب مباشرة =============
  async function refreshAccountLevelFromTracker(id, srcBtn) {
    const a = STATE.accounts.find(x => x.id === id);
    if (!a) return;
    const game = STATE.games.find(g => g.id === a.gameId);
    const cfg = getTrackerGameConfig(game);
    if (!cfg) return toast('اللعبة دي مش مدعومة في التحديث التلقائي', 'err');
    if (!a.trackerId) return toast('حدد معرف التتبع من التعديل الأول', 'err');
    // VALORANT معندوش منصة — نجيب الليفل بالاسم#التاج بس
    if (!a.platform && cfg.slug !== 'valorant') return toast('حدد المنصة ومعرف التتبع من التعديل الأول', 'err');

    const original = srcBtn ? srcBtn.textContent : null;
    if (srcBtn) { srcBtn.disabled = true; srcBtn.textContent = '⏳'; }
    try {
      const data = await fetchLevelFromTracker(
        cfg.slug,
        cfg.slug === 'valorant' ? 'pc' : a.platform,
        a.trackerId,
        (indexing) => {
          // 202: الحساب الجديد لسه بيتفهرَس — نعرض رسالة انتظار أثناء الـ Polling
          if (srcBtn) srcBtn.textContent = indexing ? '⏳ جاري ربط الحساب...' : '⏳';
          if (indexing) toast('جاري ربط الحساب لأول مرة...', 'info');
        },
        true // force: زر التحديث من الكارت بيدور بيانات فريش (بيتجاوز كاش السيرفر)
      );
      const before = a.level;
      if (data.level !== null && data.level !== undefined) {
        a.level = Math.max(0, Math.min(a.maxLevel || 100, Number(data.level)));
      }
      if (data.rank) a.rank = data.rank;
      saveUserData();
      renderCards(); // re-render بيشيل أي صندوق تسجيل قديم
      if (a.level !== before) {
        playSound(a.level > before ? 'level-up' : 'level-down');
        requestAnimationFrame(() => {
          const card = document.querySelector(`.card [data-act="refresh-level"][data-id="${CSS.escape(id)}"]`)?.closest('.card');
          const lvlEl = card?.querySelector('.level-info strong');
          if (lvlEl) {
            lvlEl.classList.remove('bump', 'up', 'down');
            void lvlEl.offsetWidth;
            lvlEl.classList.add('bump', a.level > before ? 'up' : 'down');
          }
        });
      }
      toast(`تم التحديث من Tracker.gg — المستوى ${a.level}`, 'ok');
    } catch (err) {
      console.warn('Tracker.gg refresh error:', err);
      if (err.apexNewAccount) {
        // الحساب جديد → صندوق في الكارت نفسه: زرار فتح التسجيل على ALS + إعادة الجلب
        // (بنحل عناصر الكارت من الـ DOM فريش عشان بعد renderCards بتتبني من جديد)
        const card = document.querySelector(`.card [data-act="refresh-level"][data-id="${CSS.escape(id)}"]`)?.closest('.card') || srcBtn?.closest('.card');
        if (card) {
          const onRetry = () => {
            const btn = document.querySelector(`.card [data-act="refresh-level"][data-id="${CSS.escape(id)}"]`) || srcBtn;
            refreshAccountLevelFromTracker(id, btn);
          };
          showApexRegistrationUI(card, err.apexPlatform, err.apexPlayer, onRetry);
        }
        toast('⚠️ الحساب جديد — افتح صفحة التسجيل على ALS ثم اضغط "إعادة الجلب"', 'err');
      } else {
        toast(err.message || 'فشل تحديث المستوى من Tracker.gg', 'err');
      }
      playSound('error');
    } finally {
      if (srcBtn) { srcBtn.disabled = false; srcBtn.textContent = original; }
    }
  }

  function cycleStatus(id) {
    const a = STATE.accounts.find(x => x.id === id);
    if (!a) return;
    const order = ['not-listed', 'listed', 'sold'];
    const labels = { 'not-listed': 'غير معروض', 'listed': 'معروض', 'sold': 'تم البيع' };
    a.status = order[(order.indexOf(a.status) + 1) % 3];
    if (a.status === 'sold' && !a.soldAt) {
      a.soldAt = Date.now();
      freezeSoldPrice(a, STATE.games.find(g => g.id === a.gameId));
    }
    if (a.status !== 'sold') { a.soldAt = null; a.soldNetEgp = null; }
    saveUserData();
    playSound('status');
    renderAll();
    toast('تم تغيير الحالة إلى: ' + labels[a.status], 'ok');
  }

  function deleteAccount(id) {
    const a = STATE.accounts.find(x => x.id === id);
    if (!a) return;
    if (!confirm(`حذف الحساب "${a.name}"؟`)) return;
    playSound('error');
    const doDelete = () => {
      STATE.accounts = STATE.accounts.filter(x => x.id !== id);
      // Drop any boosts that belonged to this account
      STATE.boosts = STATE.boosts.filter(b => b.accountId !== id);
      saveUserData();
      renderAll();
      toast('تم الحذف', 'ok');
    };
    const card = document.querySelector(`.card [data-act="del"][data-id="${CSS.escape(id)}"]`)?.closest('.card');
    if (card) {
      card.classList.add('removing');
      setTimeout(doDelete, 260);
    } else {
      doDelete();
    }
  }

  function copyText(text, btn) {
    if (!text) return;
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
    };
    const ok = () => {
      if (btn) {
        // For button copy-btn (legacy if any): change text briefly
        if (btn.classList.contains('copy-btn')) {
          const orig = btn.textContent;
          btn.textContent = '✓';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = orig;
            btn.classList.remove('copied');
          }, 1200);
        } else {
          // For clickable cred-val: flash a "copied" state
          btn.classList.remove('copied');
          void btn.offsetWidth;
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 1100);
        }
      }
      playSound('click');
      toast('تم النسخ ✓', 'ok');
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(ok).catch(() => { fallback(); ok(); });
    } else {
      fallback();
      ok();
    }
  }

  // ============= MODAL — GAMES =============
  function openGameModal(game = null) {
    const isEdit = !!game;
    $('#modal-title').textContent = isEdit ? 'تعديل لعبة' : 'إضافة لعبة جديدة';
    const body = $('#modal-body');
    body.innerHTML = `
      <div class="field">
        <label>اسم اللعبة</label>
        <input id="g-name" value="${esc(game?.name || '')}" placeholder="مثال: Fortnite" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>اللون المميز</label>
          <input id="g-color" type="color" value="${esc(game?.color || '#a855f7')}" />
        </div>
        <div class="field">
          <label>اختصار (3 حروف)</label>
          <input id="g-icon" maxlength="3" value="${esc(game?.icon || '')}" placeholder="FN" style="text-transform:uppercase" />
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="m-cancel">إلغاء</button>
        <button class="btn-primary" id="m-save">${isEdit ? 'حفظ التعديلات' : 'إضافة'}</button>
      </div>
    `;
    showModal();
    $('#m-cancel').onclick = closeModal;
    $('#m-save').onclick = () => {
      const name = $('#g-name').value.trim();
      const color = $('#g-color').value;
      const icon = ($('#g-icon').value || name.slice(0, 3)).toUpperCase();
      if (!name) return toast('أدخل اسم اللعبة', 'err');
      if (isEdit) {
        game.name = name;
        game.color = color;
        game.icon = icon;
      } else {
        STATE.games.push({ id: uid('g'), name, color, icon });
      }
      saveUserData();
      closeModal();
      renderAll();
      playSound(isEdit ? 'click' : 'success');
      toast(isEdit ? 'تم تعديل اللعبة' : 'تم إضافة اللعبة', 'ok');
    };
  }

  // ============= MODAL — ACCOUNTS =============
  function openAccountModal(id = null) {
    const isEdit = !!id;
    const a = isEdit ? STATE.accounts.find(x => x.id === id) : {};
    if (!a) return;
    if (STATE.games.length === 0) {
      toast('أضف لعبة أولاً', 'err');
      return openGameModal();
    }
    $('#modal-title').textContent = isEdit ? 'تعديل حساب' : 'إضافة حساب جديد';
    const body = $('#modal-body');
    body.innerHTML = `
      <div class="field">
        <label>اللعبة</label>
        <select id="a-game">
          ${STATE.games.map(g => `<option value="${esc(g.id)}" ${a.gameId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label>🕹️ المنصة (Platform) <span class="opt-tag">(اختياري)</span></label>
          <select id="a-platform">
            <option value="">— بدون —</option>
            ${TRACKER_PLATFORMS.map(p => `<option value="${esc(p.value)}" ${a.platform === p.value ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label id="a-trackerid-label">🔎 معرف التتبع (EA Name / Riot ID / Gamertag) <span class="opt-tag">(اختياري)</span></label>
          <input id="a-trackerid" type="text" value="${esc(a.trackerId || '')}" placeholder="مثال: PlayerName#1234" />
        </div>
      </div>
      <div class="field-row" style="align-items:flex-end">
        <div class="field">
          <label>المستوى الحالي</label>
          <input id="a-level" type="number" min="0" value="${a.level ?? 50}" />
        </div>
        <div class="field">
          <label>المستوى الأقصى</label>
          <input id="a-maxlevel" type="number" min="1" value="${a.maxLevel || 100}" />
        </div>
        <div class="field">
          <button type="button" class="btn-ghost" id="a-track-refresh" style="white-space:nowrap">🔄 جلب المستوى من Tracker.gg</button>
        </div>
      </div>
      <div class="field-hint" id="a-track-hint" style="margin-top:-0.6rem"></div>
      <div id="a-track-als" style="display:none"></div>
      <div class="field">
        <label>الحالة</label>
        <select id="a-status">
          <option value="not-listed" ${a.status === 'not-listed' ? 'selected' : ''}>غير معروض</option>
          <option value="listed" ${a.status === 'listed' ? 'selected' : ''}>معروض للبيع</option>
          <option value="sold" ${a.status === 'sold' ? 'selected' : ''}>تم البيع</option>
        </select>
      </div>
      <div class="field">
        <label>🖼️ صورة الحساب <span class="opt-tag">(اختياري — تُرفع مباشرة إلى Firebase Storage)</span></label>
        ${a.imageUrl ? `<div class="field-hint">في صورة محفوظة حالياً ✓ — اختر ملف جديد لاستبدالها</div><img src="${esc(a.imageUrl)}" alt="" style="max-width:100%;max-height:120px;border-radius:10px;margin:6px 0;display:block" />` : ''}
        <input type="file" id="a-image" accept="image/*" />
      </div>
      <div class="field">
        <label>ℹ️ معلومات الحساب <span class="opt-tag">(اكتبها بأي شكل يريحك — بالـ label: value، سطر لكل معلومة — بتتحفظ زي ما هي بالظبط)</span></label>
        <textarea id="a-info" placeholder="اكتب أو الصق معلومات الحساب هنا بأي شكل يريحك..." style="min-height:100px">${esc(a.info || '')}</textarea>
      </div>
      <div class="field-row">
        <div class="field">
          <label>🎖️ رانك الحساب <span class="opt-tag">(اختياري)</span></label>
          <input id="a-rank" type="text" value="${esc(a.rank || '')}" placeholder="مثال: Radiant / Diamond 2" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>💰 سعر الحساب بالدولار $ <span class="opt-tag">(اختياري)</span></label>
          <input id="a-price-usd" type="number" min="0" value="${(a.priceUsd !== undefined && a.priceUsd !== null) ? a.priceUsd : ''}" placeholder="السعر الافتراضي للعبة" />
        </div>
        <div class="field">
          <label>📊 نسبة الموقع % <span class="opt-tag">(اختياري)</span></label>
          <input id="a-site-percentage" type="number" min="0" max="100" value="${(a.sitePercentage !== undefined && a.sitePercentage !== null) ? a.sitePercentage : ''}" placeholder="نسبة اللعبة الافتراضية" />
        </div>
      </div>
      <div class="field">
        <label>📌 ملاحظات سريعة</label>
        <textarea id="a-notes" placeholder="أي ملاحظة تود تذكرها لاحقاً...">${esc(a.notes || '')}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="m-cancel">إلغاء</button>
        <button class="btn-primary" id="m-save">${isEdit ? 'حفظ التعديلات' : 'إضافة'}</button>
      </div>
    `;
    showModal();

    // ---- Tracker.gg: تحديث تلقائي للمستوى من داخل النموذج ----
    const trackHint = $('#a-track-hint');
    const refreshBtn = $('#a-track-refresh');
    const platformRow = $('#a-platform')?.closest('.field');
    const trackerIdLabel = $('#a-trackerid-label');
    function updateTrackHint() {
      const game = STATE.games.find(g => g.id === $('#a-game').value);
      const cfg = getTrackerGameConfig(game);
      const isValorant = cfg && cfg.slug === 'valorant';
      // VALORANT معندوش منصة (Riot launcher) — نخفي حقل المنصة ونجيب الليفل بالاسم#التاج بس
      if (platformRow) platformRow.style.display = isValorant ? 'none' : '';
      if (trackerIdLabel) {
        trackerIdLabel.innerHTML = isValorant
          ? '🔎 الاسم والتاج (Riot ID) <span class="opt-tag">(مثال: TenZ#SEN)</span>'
          : '🔎 معرف التتبع (EA Name / Riot ID / Gamertag) <span class="opt-tag">(اختياري)</span>';
      }
      if (!cfg) {
        trackHint.textContent = `⚠️ التحديث التلقائي متاح حالياً لـ ${Object.values(TRACKER_GAMES).map(g => g.label).join(', ')} فقط`;
        refreshBtn.disabled = true;
      } else if (isValorant) {
        trackHint.textContent = '✓ VALORANT — اكتب الاسم والتاج بالصيغة Name#Tag (مثال: TenZ#SEN) ثم دوس الزر (مفيش منصة مطلوبة)';
        refreshBtn.disabled = false;
      } else {
        trackHint.textContent = `✓ التحديث التلقائي متاح لـ ${cfg.label} — اختار المنصة واكتب معرف التتبع بعدين دوس الزر`;
        refreshBtn.disabled = false;
      }
    }
    updateTrackHint();
    $('#a-game').addEventListener('change', updateTrackHint);

    const alsBox = $('#a-track-als');
    refreshBtn.onclick = doFetch;

    async function doFetch() {
      const game = STATE.games.find(g => g.id === $('#a-game').value);
      const cfg = getTrackerGameConfig(game);
      const platform = $('#a-platform').value;
      const trackerId = $('#a-trackerid').value.trim();
      if (!cfg) return toast('اللعبة دي مش مدعومة في التحديث التلقائي لسه', 'err');
      // VALORANT مش محتاج منصة — نجيب الليفل بالاسم#التاج مباشرة (platform "pc" رمزياً)
      if (!platform && cfg.slug !== 'valorant') return toast('اختر المنصة (Platform) الأول', 'err');
      if (!trackerId) return toast('اكتب معرف التتبع (Tracker Identifier)', 'err');

      refreshBtn.disabled = true;
      const originalLabel = refreshBtn.textContent;
      refreshBtn.textContent = '⏳ جاري الجلب...';
      try {
        const data = await fetchLevelFromTracker(
          cfg.slug,
          cfg.slug === 'valorant' ? 'pc' : platform,
          trackerId,
          (indexing) => {
            // 202: الحساب الجديد لسه بيتفهرَس — نعرض رسالة انتظار أثناء الـ Polling
            refreshBtn.textContent = indexing ? '⏳ جاري ربط الحساب...' : originalLabel;
            if (indexing) toast('جاري ربط الحساب لأول مرة...', 'info');
          },
          true // force: زر الجلب بيدور بيانات فريش (بيتجاوز كاش السيرفر)
        );
        // مستوى حقيقي (رقم) فقط → نحدّث الخانة ونعرض النتيجة
        if (data.level !== null && data.level !== undefined) {
          $('#a-level').value = data.level;
        }
        if (data.rank) {
          $('#a-rank').value = data.rank;
        }
        hideApexRegistrationUI(alsBox);
        toast(`تم الجلب: المستوى ${data.level}${data.rank ? ' — ' + data.rank : ''}`, 'ok');
        playSound('success');
      } catch (err) {
        console.warn('Tracker.gg fetch error:', err);
        if (err.apexNewAccount) {
          // الحساب جديد ولسه مش مسجل على ALS → زرار فتح التسجيل + إعادة الجلب
          showApexRegistrationUI(alsBox, err.apexPlatform, err.apexPlayer, doFetch);
          toast('⚠️ الحساب جديد — افتح صفحة التسجيل على ALS ثم اضغط "إعادة الجلب"', 'err');
        } else {
          hideApexRegistrationUI(alsBox);
          toast(err.message || 'فشل جلب البيانات من Tracker.gg', 'err');
        }
        playSound('error');
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = originalLabel;
      }
    }

    $('#m-cancel').onclick = closeModal;
    $('#m-save').onclick = async () => {
      const gameId = $('#a-game').value;
      const level = +$('#a-level').value || 0;
      const maxLevel = +$('#a-maxlevel').value || 100;
      const status = $('#a-status').value;
      const info = $('#a-info').value.trim();
      const rank = $('#a-rank').value.trim();
      const platform = $('#a-platform').value || null;
      const trackerId = $('#a-trackerid').value.trim() || null;
      const priceRaw = $('#a-price-usd').value;
      const priceUsd = (priceRaw !== '' && !isNaN(priceRaw)) ? Number(priceRaw) : null;
      const percentRaw = $('#a-site-percentage').value;
      const sitePercentage = (percentRaw !== '' && !isNaN(percentRaw)) ? Number(percentRaw) : null;
      const notes = $('#a-notes').value.trim();
      if (!gameId) return toast('اختر اللعبة', 'err');
      const game = STATE.games.find(g => g.id === gameId);

      // Optional image — upload to Firebase Storage and use its URL
      let imageUrl = a.imageUrl || null;
      const imageInput = $('#a-image');
      const imageFile = imageInput && imageInput.files && imageInput.files[0];
      if (imageFile) {
        const saveBtn = $('#m-save');
        saveBtn.disabled = true;
        toast('جاري رفع الصورة...', '');
        try {
          imageUrl = await uploadFileToStorage(imageFile, 'account-images');
        } catch (e) {
          console.warn('فشل رفع الصورة:', e);
          toast('فشل رفع الصورة، سيتم الحفظ بدون تحديث الصورة', 'err');
        }
        saveBtn.disabled = false;
      }

      if (isEdit) {
        const wasSold = a.status === 'sold';
        Object.assign(a, { gameId, level, maxLevel, status, info, rank, priceUsd, sitePercentage, notes, imageUrl, platform, trackerId });
        if (status === 'sold' && !wasSold) {
          a.soldAt = Date.now();
          freezeSoldPrice(a, game);
        }
        if (status !== 'sold') { a.soldAt = null; a.soldNetEgp = null; }
      } else {
        const nextSeq = STATE.accounts.reduce((m, x) => Math.max(m, x.seq || 0), 0) + 1;
        const newAcc = {
          id: uid('a'),
          seq: nextSeq,
          name: `${game ? game.name : 'حساب'} #${nextSeq}`,
          gameId,
          level, maxLevel,
          status, info, rank, priceUsd, sitePercentage, notes, imageUrl,
          platform, trackerId,
          starred: false,
          starredAt: null,
          soldAt: status === 'sold' ? Date.now() : null,
        };
        if (status === 'sold') freezeSoldPrice(newAcc, game);
        STATE.accounts.push(newAcc);
      }
      saveUserData();
      closeModal();
      renderAll();
      playSound(isEdit ? 'click' : 'success');
      toast(isEdit ? 'تم حفظ التعديلات' : 'تم إضافة الحساب', 'ok');
    };
  }

  // ============= MODAL — تخصيص شكل العرض (per-game field/price customization) =============
  function currentSelectedGame() {
    if (STATE.currentGame === 'all' || !STATE.currentGame) return null;
    return STATE.games.find(g => g.id === STATE.currentGame) || null;
  }

  let pinFieldRowCount = 0;
  function addPinFieldRow(container, prefill) {
    const rowId = 'pinfieldrow_' + (pinFieldRowCount++);
    const row = document.createElement('div');
    row.className = 'fields-editor-row';
    row.id = rowId;
    row.innerHTML = `
      <input type="text" placeholder="اسم الحقل، زي Email أو Date of birth" value="${esc(prefill || '')}" />
      <button type="button" class="field-del-btn" data-remove-row="${rowId}">✕</button>
    `;
    container.appendChild(row);
    row.querySelector('[data-remove-row]').addEventListener('click', () => row.remove());
  }

  function openPinConfigModal() {
    const game = currentSelectedGame();
    if (!game) { toast('اختر لعبة معيّنة أولاً (مش "كل الألعاب")', 'err'); return; }
    const cfg = getGamePinConfig(game);
    $('#modal-title').textContent = `⚙️ تخصيص شكل عرض ${game.name}`;
    const body = $('#modal-body');
    body.innerHTML = `
      <div class="field">
        <label>🔑 اسم المفتاح لجلب اسم الحساب تلقائياً <span class="opt-tag">(اختياري — لازم يطابق اسم السطر في "معلومات الحساب" بالظبط، مثال: Steam Name)</span></label>
        <input id="pc-namekey" type="text" placeholder="مثال: Steam Name" value="${esc(cfg.nameKey || '')}" />
      </div>
      <div class="field">
        <label>💰 السعر الافتراضي بالدولار $ لكل حسابات اللعبة دي <span class="opt-tag">(اختياري، الافتراضي 150$)</span></label>
        <input id="pc-price" type="number" min="0" value="${cfg.defaultPrice}" />
      </div>
      <div class="field">
        <label>📊 نسبة الموقع % <span class="opt-tag">(النسبة اللي الموقع بياخدها منك، الافتراضي 0%)</span></label>
        <input id="pc-percentage" type="number" min="0" max="100" value="${cfg.sitePercentage}" />
      </div>
      <div class="field">
        <label>⏱️ مدة التايمر الافتراضية (بالساعات) <span class="opt-tag">(بتتفعّل تلقائياً عند الضغط على زر السحابة ☁️ لحسابات هذه اللعبة، الافتراضي 24 ساعة)</span></label>
        <input id="pc-timer-hours" type="number" min="0" step="0.5" value="${cfg.defaultTimerHours}" />
      </div>
      <label style="display:block; color:var(--muted); font-size:0.8rem; margin-bottom:0.4rem;">📋 حقول إضافية تظهر تحت بيانات كل حساب <span class="opt-tag">(اختياري — لازم يطابق اسم السطر في "معلومات الحساب" بالظبط)</span></label>
      <div class="fields-editor" id="pc-fields-editor"></div>
      <button type="button" class="add-field-row-btn" id="pc-add-row">➕ إضافة حقل</button>
      <div class="modal-actions" style="margin-top:1rem">
        <button class="btn-ghost" id="m-cancel">إلغاء</button>
        <button class="btn-primary" id="m-save">💾 حفظ</button>
      </div>
    `;
    showModal();
    const editor = $('#pc-fields-editor');
    pinFieldRowCount = 0;
    if (cfg.rows.length) cfg.rows.forEach(v => addPinFieldRow(editor, v));
    else addPinFieldRow(editor, '');
    $('#pc-add-row').onclick = () => addPinFieldRow(editor, '');
    $('#m-cancel').onclick = closeModal;
    $('#m-save').onclick = () => {
      const inputs = [...editor.querySelectorAll('.fields-editor-row input')];
      const rows = [...new Set(inputs.map(i => i.value.trim()).filter(Boolean))];
      const priceRaw = $('#pc-price').value;
      const defaultPrice = (priceRaw !== '' && !isNaN(priceRaw)) ? Number(priceRaw) : 150;
      const percentRaw = $('#pc-percentage').value;
      const sitePercentage = (percentRaw !== '' && !isNaN(percentRaw)) ? Number(percentRaw) : 0;
      const nameKey = $('#pc-namekey').value.trim();
      const timerHoursRaw = $('#pc-timer-hours').value;
      const defaultTimerHours = (timerHoursRaw !== '' && !isNaN(timerHoursRaw) && Number(timerHoursRaw) > 0) ? Number(timerHoursRaw) : 24;
      game.pinConfig = { rows, defaultPrice, sitePercentage, nameKey, defaultTimerHours };
      saveUserData();
      closeModal();
      renderCards();
      playSound('success');
      toast('تم حفظ شكل العرض ✓', 'ok');
    };
  }

  // ============= MODAL — إنشاء تفاصيل الحساب (template-driven step-by-step wizard) =============
  // Flow: the user pastes the *shape* of the account details once per game
  // (field names only, e.g. "Email:" / "Date of birth:" — no actual values).
  // We parse that into a list of fields, then ask about each one individually,
  // and finally rebuild the original template with the answers filled in.
  const TEMPLATE_PLACEHOLDER =
`Date of birth: 
Location: 
Date of creation: 
Account Region: 
City of the account: 
Email: 
Username: 
password: 
Summoner Name: `;

  let detailsGame = null;
  let detailsFields = [];   // [{ label, lineIndex }]
  let detailsAnswers = [];
  let detailsStepIndex = 0;

  // Parses a pasted template into a list of question fields. Any line that
  // contains "label:" becomes a question; lines without a colon are kept
  // as-is (untouched) when the final result is rebuilt.
  function parseDetailsTemplate(raw) {
    const lines = raw.split('\n');
    const fields = [];
    lines.forEach((line, lineIndex) => {
      const m = line.match(/^\s*([^:：]+)[:：]/);
      if (m && m[1].trim()) fields.push({ label: m[1].trim(), lineIndex });
    });
    return fields;
  }

  function openDetailsWizardModal() {
    const game = currentSelectedGame();
    if (!game) { toast('اختر لعبة معيّنة أولاً (مش "كل الألعاب")', 'err'); return; }
    detailsGame = game;
    if (game.detailsTemplate && game.detailsTemplate.fields && game.detailsTemplate.fields.length) {
      startDetailsWizardFromTemplate(game);
    } else {
      openDetailsTemplateModal(game);
    }
  }

  // Step 0 — ask the user for the "shape" of the account details (once per game)
  function openDetailsTemplateModal(game, prefillRaw) {
    $('#modal-title').textContent = `🧾 شكل تفاصيل الحساب — ${game.name}`;
    const body = $('#modal-body');
    const raw = prefillRaw !== undefined ? prefillRaw : (game.detailsTemplate ? game.detailsTemplate.raw : '');
    body.innerHTML = `
      <div class="field">
        <label>الصق شكل تفاصيل الحساب <span class="opt-tag">(كل بيانة في سطر لوحدها، اسم البيانة و: بس، من غير ما تكتب أي قيمة فعلية)</span></label>
        <textarea id="tmpl-input" rows="11" style="font-family:'IBM Plex Mono', monospace; direction:ltr; text-align:left;" placeholder="${esc(TEMPLATE_PLACEHOLDER)}">${esc(raw)}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="tmpl-cancel">إلغاء</button>
        <button class="btn-primary" id="tmpl-next">التالي ➡️</button>
      </div>
    `;
    showModal();
    $('#tmpl-cancel').onclick = closeModal;
    $('#tmpl-next').onclick = () => {
      const rawVal = $('#tmpl-input').value;
      const fields = parseDetailsTemplate(rawVal);
      if (!fields.length) {
        playSound('error');
        toast('اكتب حقل واحد على الأقل، كل حقل في سطر لوحده منتهي بـ ":"', 'err');
        return;
      }
      game.detailsTemplate = { raw: rawVal, fields };
      saveUserData();
      startDetailsWizardFromTemplate(game);
    };
  }

  function startDetailsWizardFromTemplate(game) {
    detailsGame = game;
    detailsFields = game.detailsTemplate.fields;
    detailsAnswers = detailsFields.map(() => '');
    detailsStepIndex = 0;
    $('#modal-title').textContent = `🧾 إنشاء تفاصيل حساب — ${game.name}`;
    showModal();
    renderDetailsStep();
  }

  function renderDetailsStep() {
    const body = $('#modal-body');
    const total = detailsFields.length;
    const label = detailsFields[detailsStepIndex].label;
    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
        <div style="font-family:'IBM Plex Mono', monospace; font-size:0.75rem; color:var(--muted);">سؤال ${detailsStepIndex + 1} من ${total}</div>
        <button type="button" id="details-change-tmpl" style="background:none; border:none; color:var(--muted); font-size:0.72rem; cursor:pointer; text-decoration:underline;">🔄 تغيير شكل التفاصيل</button>
      </div>
      <div class="field">
        <label>${esc(label)}:</label>
        <input id="details-answer" type="text" value="${esc(detailsAnswers[detailsStepIndex] || '')}" placeholder="اكتب ${esc(label)}..." autocomplete="off" />
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="details-back" ${detailsStepIndex === 0 ? 'style="visibility:hidden"' : ''}>⬅️ رجوع</button>
        <button class="btn-primary" id="details-next">${detailsStepIndex === total - 1 ? '✅ إنهاء وعرض الكل' : 'التالي ➡️'}</button>
      </div>
    `;
    const input = $('#details-answer');
    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); detailsGoNext(); } });
    $('#details-back').onclick = detailsGoBack;
    $('#details-next').onclick = detailsGoNext;
    $('#details-change-tmpl').onclick = () => {
      detailsSaveCurrentAnswer();
      openDetailsTemplateModal(detailsGame, detailsGame.detailsTemplate.raw);
    };
  }

  function detailsSaveCurrentAnswer() {
    const input = $('#details-answer');
    if (input) detailsAnswers[detailsStepIndex] = input.value.trim();
  }

  function detailsGoNext() {
    detailsSaveCurrentAnswer();
    if (detailsStepIndex < detailsFields.length - 1) {
      detailsStepIndex++;
      renderDetailsStep();
    } else {
      finishDetailsWizard();
    }
  }

  function detailsGoBack() {
    if (detailsStepIndex === 0) return;
    detailsSaveCurrentAnswer();
    detailsStepIndex--;
    renderDetailsStep();
  }

  function finishDetailsWizard() {
    // Rebuild the original pasted template, filling each labeled line with
    // its answer and leaving every other line exactly as the user wrote it.
    const lines = detailsGame.detailsTemplate.raw.split('\n');
    detailsFields.forEach((f, i) => {
      lines[f.lineIndex] = `${f.label}: ${detailsAnswers[i] || ''}`;
    });
    const text = lines.join('\n');
    const body = $('#modal-body');
    body.innerHTML = `
      <div class="field">
        <label>✅ تفاصيل الحساب كاملة <span class="opt-tag">(دوس على الصندوق عشان تنسخ كل البيانات مرة واحدة، بعدين الصقها في خانة "معلومات الحساب")</span></label>
        <div class="acc-info cred-clickable" id="details-result-box" data-copy-text="${esc(text)}" style="cursor:pointer">${esc(text)}</div>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="details-close">❌ إغلاق</button>
        <button class="btn-ghost" id="details-new-template">🧾 تغيير شكل التفاصيل</button>
        <button class="btn-primary" id="details-restart">🔁 حساب جديد (نفس الشكل)</button>
      </div>
    `;
    $('#details-result-box').addEventListener('click', () => copyText(text, $('#details-result-box')));
    $('#details-close').onclick = closeModal;
    $('#details-restart').onclick = () => startDetailsWizardFromTemplate(detailsGame);
    $('#details-new-template').onclick = () => openDetailsTemplateModal(detailsGame, detailsGame.detailsTemplate.raw);
    playSound('success');
  }

  // ============= MODAL CONTROL =============
  function showModal() {
    $('#modal').classList.remove('hidden');
    setTimeout(() => {
      const first = $('#modal-body input, #modal-body select');
      if (first) first.focus();
    }, 100);
  }
  function closeModal() {
    const modal = $('#modal');
    modal.classList.add('closing');
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('closing');
    }, 200);
  }

  // ============= ANALYTICS =============
  let chartM, chartD;

  function renderAnalytics() {
    const sold = STATE.accounts.filter(a => a.status === 'sold');
    const monthly = {};
    const daily = {};
    sold.forEach(a => {
      if (!a.soldAt) return;
      const d = new Date(a.soldAt);
      const m = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const game = STATE.games.find(g => g.id === a.gameId);
      const profit = getAccountProfitEgp(a, game);
      monthly[m] = (monthly[m] || 0) + profit;
      daily[day] = (daily[day] || 0) + profit;
    });

    // Monthly chart — PURPLE (matches the image)
    const mLabels = Object.keys(monthly);
    const mValues = Object.values(monthly);
    if (chartM) chartM.destroy();
    chartM = new Chart($('#chart-monthly').getContext('2d'), {
      type: 'bar',
      data: {
        labels: mLabels.length ? mLabels : ['—'],
        datasets: [{
          label: 'الأرباح الشهرية (ج.م)',
          data: mValues.length ? mValues : [0],
          backgroundColor: ctx => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 260);
            g.addColorStop(0, 'rgba(168, 85, 247, 0.95)');
            g.addColorStop(1, 'rgba(168, 85, 247, 0.15)');
            return g;
          },
          borderColor: 'rgba(192, 132, 252, 1)',
          borderWidth: 1,
          borderRadius: 8,
        }]
      },
      options: chartOpts('الأرباح (ج.م)')
    });

    // Daily chart — MINT GREEN (matches the image)
    const dLabels = Object.keys(daily);
    const dValues = Object.values(daily);
    if (chartD) chartD.destroy();
    chartD = new Chart($('#chart-daily').getContext('2d'), {
      type: 'line',
      data: {
        labels: dLabels.length ? dLabels : ['—'],
        datasets: [{
          label: 'الأرباح اليومية (ج.م)',
          data: dValues.length ? dValues : [0],
          borderColor: 'rgba(74, 222, 128, 1)',
          backgroundColor: ctx => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 260);
            g.addColorStop(0, 'rgba(74, 222, 128, 0.40)');
            g.addColorStop(1, 'rgba(74, 222, 128, 0)');
            return g;
          },
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#4ade80',
          pointBorderColor: '#0c0a1e',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2.5,
        }]
      },
      options: chartOpts('الربح اليومي (ج.م)')
    });

    const totalProfit = sold.reduce((s, a) => s + getAccountProfitEgp(a, STATE.games.find(g => g.id === a.gameId)), 0);
    const hours = STATE.hours || sold.reduce((s, a) => s + (+a.hoursSpent || 0), 0);
    const ph = hours > 0 ? Math.round(totalProfit / hours) : 0;
    $('#profit-hour').innerHTML = `${fmt(ph)} <span>ج.م/ساعة</span>`;
    $('#hours-input').value = hours || '';
  }

  function chartOpts(yLabel) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { labels: { color: '#d4d2e8', font: { family: 'Cairo', size: 12 } } },
        tooltip: {
          backgroundColor: 'rgba(12, 10, 30, 0.96)',
          borderColor: 'rgba(168, 85, 247, 0.5)',
          borderWidth: 1,
          padding: 10,
          titleColor: '#c084fc',
          bodyColor: '#f1f0fa',
          titleFont: { family: 'IBM Plex Mono', size: 12 },
          bodyFont: { family: 'IBM Plex Mono', size: 12 },
        }
      },
      scales: {
        x: {
          ticks: { color: '#8b89a8', font: { family: 'IBM Plex Mono', size: 11 } },
          grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        },
        y: {
          ticks: { color: '#8b89a8', font: { family: 'IBM Plex Mono', size: 11 }, callback: v => fmt(v) },
          grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          title: { display: true, text: yLabel, color: '#8b89a8', font: { family: 'Cairo', size: 11 } },
        }
      }
    };
  }

  // ============= SALES LOG =============
  function renderSalesLog() {
    const tbody = $('#sales-tbody');
    const sold = [...STATE.salesLog].sort((a, b) => (b.soldAt || 0) - (a.soldAt || 0));

    if (sold.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2.5rem;color:var(--muted)">لا توجد مبيعات بعد. غيّر حالة أي حساب إلى "تم البيع" وستظهر هنا.</td></tr>`;
      return;
    }

    const total = sold.reduce((s, l) => s + (Number(l.profitEgp) || 0), 0);
    tbody.innerHTML = sold.map(l => {
      const d = l.soldAt ? new Date(l.soldAt).toLocaleDateString('en-GB') : '-';
      const profit = Number(l.profitEgp) || 0;
      return `
        <tr>
          <td>${esc(l.accountName)}</td>
          <td>${esc(l.gameName)}</td>
          <td>${d}</td>
          <td>${fmt(profit)} ج.م</td>
          <td class="profit">+${fmt(profit)} ج.م</td>
          <td class="sales-del-col"><button type="button" class="sales-del-btn" data-act="sales-del" data-log-id="${esc(l.id)}" title="حذف هذا السطر من السجل">✕</button></td>
        </tr>
      `;
    }).join('') + `
      <tr style="font-weight:800;background:rgba(74, 222, 128, 0.05)">
        <td colspan="4" style="text-align:left;color:var(--text)">الإجمالي</td>
        <td class="profit" style="font-size:1.05rem">+${fmt(total)} ج.م</td>
        <td></td>
      </tr>
    `;

    tbody.querySelectorAll('[data-act="sales-del"]').forEach(btn => {
      btn.addEventListener('click', () => deleteSalesLogEntry(btn.dataset.logId));
    });
  }

  // ============= PASSWORD STRENGTH =============
  function updatePwStrength() {
    const pw = $('#signup-pass').value;
    const bar = $('#pw-strength .pw-bar');
    if (!bar) return;
    bar.classList.remove('med', 'strong');
    if (pw.length === 0) return;
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score >= 3) bar.classList.add('med');
    if (score >= 4) bar.classList.add('strong');
  }

  // ============= PASSWORD TOGGLE =============
  const EYE_SVG = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

  function bindPwToggles() {
    $$('.toggle-pw').forEach(btn => {
      btn.innerHTML = EYE_SVG;
      btn.addEventListener('click', () => {
        const id = btn.dataset.target;
        const input = document.getElementById(id);
        if (!input) return;
        if (input.type === 'password') {
          input.type = 'text';
          btn.innerHTML = EYE_OFF_SVG;
        } else {
          input.type = 'password';
          btn.innerHTML = EYE_SVG;
        }
      });
    });
  }

  // 3D tilt on the auth card that follows the mouse (sign-in-card-2)
  function bindAuthTilt() {
    const wrap = $('#auth-tilt');
    if (!wrap) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = null;
    const onMove = e => {
      const r = wrap.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rx = (0.5 - py) * 8;
      const ry = (px - 0.5) * 10;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        wrap.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
      });
    };
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      wrap.style.transform = '';
    };
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerleave', onLeave);
  }

  // Dock magnifier — a bulletproof, layout-independent hover wave for the nav.
  // Button centers are measured once (transform never affects layout), and each
  // scale is eased with frame-rate-independent exponential smoothing, which is
  // monotonic and mathematically incapable of oscillating, glitching or
  // touching any backdrop-filter compositing.
  function initDockMagnifier() {
    const nav = $('.nav');
    if (!nav) return;
    const btns = Array.from(nav.querySelectorAll('.nav-btn'));
    const MAX = 150;
    const MIN_S = 1, MAX_S = 1.45;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    // Cached horizontal centers — static, since scale never changes layout
    let centers = [];
    const measure = () => {
      centers = btns.map(b => {
        const r = b.getBoundingClientRect();
        return r.left + r.width / 2;
      });
    };
    measure();
    window.addEventListener('resize', measure);

    const scales = btns.map(() => MIN_S);
    const applyAll = () => btns.forEach((b, i) => {
      b.style.transform = `scale(${scales[i].toFixed(3)})`;
    });

    let raf = null;
    let lastT = 0;
    let mouseX = -Infinity;
    let over = false;

    const frame = t => {
      raf = null;
      if (!lastT) lastT = t;
      const dt = clamp((t - lastT) / 1000, 0, 0.05);
      lastT = t;
      const k = 1 - Math.exp(-dt * 14); // exponential smoothing factor (0..1)
      let done = true;
      for (let i = 0; i < btns.length; i++) {
        const dist = Math.abs(mouseX - centers[i]);
        const target = over && dist < MAX
          ? MIN_S + (1 - dist / MAX) * (MAX_S - MIN_S)
          : MIN_S;
        const next = scales[i] + (target - scales[i]) * k;
        scales[i] = clamp(next, MIN_S, MAX_S);
        if (Math.abs(target - scales[i]) > 0.002) done = false;
      }
      applyAll();
      if (!done) raf = requestAnimationFrame(frame);
    };

    const kick = () => { if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); } };

    nav.addEventListener('mousemove', e => { mouseX = e.clientX; kick(); });
    // Re-measure on enter: at init the app is hidden (auth gate), so rects are
    // all zeros until the user logs in and the dock becomes visible.
    nav.addEventListener('mouseenter', () => { measure(); over = true; kick(); });
    nav.addEventListener('mouseleave', () => { over = false; kick(); });
  }

  // ============= INIT =============
  function init() {
    // Splash + auth
    initSplash();

    // Form bindings
    $('#form-login').addEventListener('submit', handleLogin);
    $('#form-signup').addEventListener('submit', handleSignup);
    $('#form-forgot').addEventListener('submit', handleForgot);

    // Switch form links
    $$('[data-switch]').forEach(btn => {
      btn.addEventListener('click', () => showForm(btn.dataset.switch));
    });

    // Password strength + toggle
    $('#signup-pass').addEventListener('input', updatePwStrength);
    bindPwToggles();
    bindAuthTilt();
    initDockMagnifier();

    // Logout
    $('#logout').addEventListener('click', logout);

    // Nav
    $$('.nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

    // Add buttons
    $('#add-game').addEventListener('click', () => openGameModal());
    $('#add-account').addEventListener('click', () => openAccountModal());
    $('#customize-display').addEventListener('click', () => openPinConfigModal());
    $('#account-details').addEventListener('click', () => openDetailsWizardModal());

    // Live USD → EGP rate (used by the price badge on each card)
    loadUsdToEgpRate();
    setInterval(loadUsdToEgpRate, 60 * 1000);

    // Modal
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    // Hours input
    $('#hours-input').addEventListener('input', e => {
      STATE.hours = +e.target.value || 0;
      saveUserData();
      const sold = STATE.accounts.filter(a => a.status === 'sold');
      const totalProfit = sold.reduce((s, a) => s + getAccountProfitEgp(a, STATE.games.find(g => g.id === a.gameId)), 0);
      const ph = STATE.hours > 0 ? Math.round(totalProfit / STATE.hours) : 0;
      $('#profit-hour').innerHTML = `${fmt(ph)} <span>ج.م/ساعة</span>`;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
