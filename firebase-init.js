/* ============================================
   GAME OVER — Firebase Initialization
   - Initializes the Firebase app
   - Exposes window.db (Firestore) and window.storage (Storage)
   - Loaded BEFORE app.js so the rest of the app can use the cloud
   ============================================ */

(function () {
  'use strict';

  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyD51Bbh4-Bcchi0Ywr0U8bsa_6L4bMsr0s",
    authDomain: "game-over-2f480.firebaseapp.com",
    projectId: "game-over-2f480",
    storageBucket: "game-over-2f480.firebasestorage.app",
    messagingSenderId: "546337434031",
    appId: "1:546337434031:web:95341e2ea73af1b0ef675a",
    measurementId: "G-D8VR5YHMLH"
  };

  try {
    if (typeof firebase === 'undefined') {
      console.warn('⚠️ Firebase SDK لم يتم تحميله — تأكد من اتصال الإنترنت وروابط الـ CDN في index.html');
      window.db = null;
      window.storage = null;
      window.auth = null;
      return;
    }

    firebase.initializeApp(firebaseConfig);

    // Auth — تسجيل الدخول/الحساب الرسمي عبر Firebase Authentication.
    // كل بيانات هوية المستخدم (كلمة المرور، الجلسة) بيتم التعامل معها
    // بالكامل من طرف Firebase نفسه، مفيش تخزين يدوي لباسورد أو هاش هنا.
    window.auth = firebase.auth();

    // Firestore — يخزن بيانات كل مستخدم (الألعاب، الحسابات، الأرشيف/الـ
    // boosts، سجل المبيعات) في userData، مربوطة بمعرّف المستخدم (uid).
    window.db = firebase.firestore();

    // Storage — لرفع أي ملفات/صور يحتاجها الموقع (صور الحسابات مثلاً)
    window.storage = firebase.storage();

    // يسمح للموقع بالعمل واستخدام آخر نسخة محفوظة حتى لو قُطع الإنترنت،
    // ثم تتزامن البيانات تلقائياً بمجرد رجوع الاتصال.
    window.db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn('Firestore offline persistence: متصفح مفتوح في أكثر من تبويب، التخزين المؤقت سيعمل في تبويب واحد فقط.');
      } else if (err.code === 'unimplemented') {
        console.warn('Firestore offline persistence: المتصفح الحالي لا يدعم هذه الميزة.');
      } else {
        console.warn('Firestore offline persistence لم تُفعّل:', err);
      }
    });

    console.log('✅ Firebase مهيّأ بنجاح — مشروع game-over-2f480');
  } catch (e) {
    console.error('❌ فشل تهيئة Firebase، سيعمل الموقع بالتخزين المحلي فقط:', e);
    window.db = null;
    window.storage = null;
  }
})();
