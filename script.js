import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, deleteDoc, doc, setDoc, query, where, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDZAkAzFsmwPYgTBefkr6Cdz5ZZBrEHwWo",
  authDomain: "alkholasa-60003.firebaseapp.com",
  projectId: "alkholasa-60003",
  storageBucket: "alkholasa-60003.firebasestorage.app",
  messagingSenderId: "809389270420",
  appId: "1:809389270420:web:cf94dbed51d932b50edb81",
  measurementId: "G-RHPV6M0L20"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let currentTrack = 'انتظام';
let currentSubjectId = null;
let currentLectureId = null;
let activeQuiz = null;
let studentName = '';
let builderQuestions = [];
let currentMediaData = null;

let subjects = [];
let lectures = [];
let quizzes = [];
let lecturesCount = null;

// ===== تخزين مؤقت لتقليل القراءات من Firestore =====
const CACHE_TTL = 10 * 60 * 1000; // 10 دقايق

function cacheGet(key) {
    try {
        const raw = localStorage.getItem('kh_cache_' + key);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (Date.now() - obj.t > CACHE_TTL) return null;
        return obj.d;
    } catch (e) {
        return null;
    }
}

function cacheStale(key) {
    try {
        const o = JSON.parse(localStorage.getItem('kh_cache_' + key));
        return o ? o.d : null;
    } catch (e) {
        return null;
    }
}

function cacheSet(key, data) {
    try {
        localStorage.setItem('kh_cache_' + key, JSON.stringify({ t: Date.now(), d: data }));
    } catch (e) {}
}

function cacheClear() {
    try {
        Object.keys(localStorage).forEach(function(k) {
            if (k.indexOf('kh_cache_') === 0) localStorage.removeItem(k);
        });
    } catch (e) {}
}

async function loadSubjects(force) {
    if (!force) {
        const c = cacheGet('subjects');
        if (c) { subjects = c; return; }
    }
    try {
        const snap = await getDocs(collection(db, "subjects"));
        subjects = [];
        snap.forEach(function(d) { subjects.push({ id: d.id, ...d.data() }); });
        cacheSet('subjects', subjects);
    } catch (e) {
        console.error("Subjects error:", e);
        const st = cacheStale('subjects');
        if (st) subjects = st;
    }
}

async function loadLectureCount(force) {
    if (!force) {
        const c = cacheGet('lecCount');
        if (c !== null) { lecturesCount = c; return; }
    }
    // 1) قراءة واحدة من وثيقة الإحصائيات (الأرخص والأضمن)
    try {
        const m = await getDoc(doc(db, "meta", "stats"));
        if (m.exists() && typeof m.data().lectures === 'number') {
            lecturesCount = m.data().lectures;
            cacheSet('lecCount', lecturesCount);
            return;
        }
    } catch (e) {
        console.error("Stats doc error:", e);
    }
    // 2) لو مفيش وثيقة: نعد من السيرفر
    try {
        const r = await getCountFromServer(collection(db, "lectures"));
        lecturesCount = r.data().count;
        cacheSet('lecCount', lecturesCount);
    } catch (e) {
        console.error("Count error:", e);
        const st = cacheStale('lecCount');
        if (st !== null) lecturesCount = st;
    }
}

// الأدمن فقط: تحديث رقم المحاضرات في وثيقة الإحصائيات
async function syncLectureCount(delta) {
    if (!currentUser || !currentUser.isAdmin) return;
    let n = null;
    try {
        const r = await getCountFromServer(collection(db, "lectures"));
        n = r.data().count;
    } catch (e) {
        if (typeof lecturesCount === 'number' && typeof delta === 'number') n = Math.max(0, lecturesCount + delta);
    }
    if (n === null) return;
    try {
        await setDoc(doc(db, "meta", "stats"), { lectures: n, updatedAt: Date.now() });
    } catch (e) {
        console.error("Sync count error:", e);
    }
}

async function loadLecturesOf(subjectId, force) {
    const key = 'lec_' + subjectId;
    if (!force) {
        const c = cacheGet(key);
        if (c) { lectures = c; return; }
    }
    const q = query(collection(db, "lectures"), where("subjectId", "==", String(subjectId)));
    const snap = await getDocs(q);
    lectures = [];
    snap.forEach(function(d) { lectures.push({ id: d.id, ...d.data() }); });
    cacheSet(key, lectures);
}

async function loadQuizzes(force) {
    if (!force) {
        const c = cacheGet('quizzes');
        if (c) { quizzes = c; return; }
    }
    const snap = await getDocs(collection(db, "quizzes"));
    quizzes = [];
    snap.forEach(function(d) { quizzes.push({ id: d.id, ...d.data() }); });
    cacheSet('quizzes', quizzes);
}

async function loadDataFromCloud(force) {
    try {
        await loadSubjects(force);
        await loadLectureCount(force);
    } catch (e) {
        console.error("Cloud sync error:", e);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    loadDataFromCloud().then(() => {
        updateStats();
        if (document.getElementById('antizam') && document.getElementById('antizam').classList.contains('active')) renderSubjects('انتظام');
        if (document.getElementById('antisab') && document.getElementById('antisab').classList.contains('active')) renderSubjects('انتساب');
    });
});

window.addEventListener('scroll', () => {
    const btn = document.getElementById('back-to-top');
    if (btn) btn.style.display = window.scrollY > 300 ? 'flex' : 'none';
});

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== مساعدات: بحث عربي + تقدم المذاكرة =====
function normAr(t) {
    return String(t || '').toLowerCase()
        .replace(/[ً-ْـ]/g, '')
        .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
}
function matchSearch(text, inputId) {
    const el = document.getElementById(inputId);
    const q = el ? normAr(el.value) : '';
    return !q || normAr(text).indexOf(q) !== -1;
}

function studiedKey() { return 'kh_studied_' + (currentUser ? currentUser.uid : ''); }
function getStudied() {
    try { return JSON.parse(localStorage.getItem(studiedKey()) || '[]'); } catch (e) { return []; }
}
function isStudied(id) { return getStudied().indexOf(String(id)) !== -1; }
function toggleStudied(id) {
    id = String(id);
    let list = getStudied();
    if (list.indexOf(id) !== -1) list = list.filter(function(x) { return x !== id; });
    else list.push(id);
    try { localStorage.setItem(studiedKey(), JSON.stringify(list)); } catch (e) {}
    const btn = document.getElementById('studied-btn');
    if (btn) {
        const on = isStudied(id);
        btn.classList.toggle('on', on);
        btn.innerText = on ? '✅ تمت مذاكرتها' : 'علّم كمتذاكرة ✓';
    }
}

// ===== الإعلان في الصفحة الرئيسية =====
async function loadAnnouncement() {
    const box = document.getElementById('announce-box');
    const txt = document.getElementById('announce-text');
    if (!box || !txt) return;
    let data = cacheGet('announce');
    if (!data) {
        try {
            const snap = await getDoc(doc(db, 'meta', 'announce'));
            data = snap.exists() ? snap.data() : { text: '' };
            cacheSet('announce', data);
        } catch (e) {
            console.error('Announce error:', e);
            data = cacheStale('announce') || { text: '' };
        }
    }
    const t = (data.text || '').trim();
    txt.textContent = t;
    box.style.display = t ? 'flex' : 'none';
}

function openAnnounceModal() {
    const cur = document.getElementById('announce-text');
    document.getElementById('announce-input').value = cur ? cur.textContent : '';
    document.getElementById('announce-modal').style.display = 'flex';
}

async function saveAnnouncement() {
    const text = document.getElementById('announce-input').value.trim();
    try {
        await setDoc(doc(db, 'meta', 'announce'), { text: text, at: Date.now() });
        cacheSet('announce', { text: text });
        closeModal('announce-modal');
        await loadAnnouncement();
    } catch (e) {
        console.error(e);
        alert('تعذر حفظ الإعلان: ' + e.message);
    }
}

function updateStats() {
    loadAnnouncement();
    const subCountEl = document.getElementById('stat-subjects-count');
    const lecCountEl = document.getElementById('stat-lectures-count');
    if (subCountEl) subCountEl.innerText = subjects.length;
    if (lecCountEl) lecCountEl.innerText = (lecturesCount === null ? '—' : lecturesCount);
}

function showPage(pageId) {
    if (!currentUser) {
        openAuthModal();
        return;
    }
    if (pageId !== 'quiz-solve') stopQuizTimer();
    
    document.querySelectorAll('.page').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
    });
    
    const page = document.getElementById(pageId);
    if (page) {
        page.style.display = 'block';
        page.classList.add('active');
    }
    
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.remove('active');
        const oc = b.getAttribute('onclick') || '';
        if (oc.indexOf("showPage('" + pageId + "')") !== -1) b.classList.add('active');
    });

    if (pageId === 'antizam') {
        renderSubjects('انتظام');
    } else if (pageId === 'antisab') {
        renderSubjects('انتساب');
    } else if (pageId === 'quizzes') {
        const grid = document.getElementById('quizzes-grid');
        if (grid && quizzes.length === 0) {
            grid.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:2rem;">جاري التحميل...</p>';
        }
        loadQuizzes().then(renderQuizzes).catch(function(e) {
            console.error("Quizzes load error:", e);
            renderQuizzes();
        });
    } else if (pageId === 'home') {
        updateStats();
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const themeIcon = document.getElementById('theme-icon');
    if (html.getAttribute('data-theme') === 'dark') {
        html.setAttribute('data-theme', 'light');
        if (themeIcon) themeIcon.className = 'fa-solid fa-sun';
    } else {
        html.setAttribute('data-theme', 'dark');
        if (themeIcon) themeIcon.className = 'fa-solid fa-moon';
    }
}

// ==========================================================
//  الحسابات (Firebase Authentication)
// ==========================================================
const ADMIN_EMAILS = ['admin@alkholasa.com'];
let authMode = 'login';
let authBusy = false;
let firstAuthCheck = true;

function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === 'signup';
    document.getElementById('auth-name-group').style.display = signup ? 'block' : 'none';
    document.getElementById('auth-confirm-group').style.display = signup ? 'block' : 'none';
    document.getElementById('auth-forgot').style.display = signup ? 'none' : 'inline-block';
    document.getElementById('tab-login').classList.toggle('active', !signup);
    document.getElementById('tab-signup').classList.toggle('active', signup);
    document.getElementById('auth-submit').innerText = signup ? 'إنشاء الحساب' : 'دخول للمنصة';
    document.getElementById('auth-sub').innerText = signup ? 'أنشئ حسابك للدخول إلى المنصة' : 'يرجى تسجيل الدخول للمتابعة إلى المنصة';
    setAuthMsg('', false);
}

function setAuthMsg(text, good) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.innerText = text;
    el.classList.toggle('good', !!good);
}

function authErrorText(e) {
    const map = {
        'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة.',
        'auth/user-not-found': 'لا يوجد حساب بهذا البريد.',
        'auth/wrong-password': 'كلمة المرور غير صحيحة.',
        'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
        'auth/email-already-in-use': 'هذا البريد مسجل بالفعل، سجّل الدخول بدلاً من ذلك.',
        'auth/weak-password': 'كلمة المرور ضعيفة، اكتب 6 أحرف أو أرقام على الأقل.',
        'auth/too-many-requests': 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة.',
        'auth/network-request-failed': 'مشكلة في الاتصال بالإنترنت.',
        'auth/operation-not-allowed': 'تسجيل الدخول بالبريد غير مفعّل في Firebase. فعّل Email/Password من لوحة Firebase.',
        'auth/missing-password': 'اكتب كلمة المرور.'
    };
    return map[e && e.code] || ('حدث خطأ: ' + (e && e.message ? e.message : 'غير معروف'));
}

async function handleAuth() {
    if (authBusy) return;
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-pass').value;
    const signup = authMode === 'signup';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setAuthMsg('اكتب بريد إلكتروني صحيح.', false); return; }
    if (!pass) { setAuthMsg('اكتب كلمة المرور.', false); return; }

    let name = '';
    if (signup) {
        name = document.getElementById('auth-name').value.trim().replace(/\s+/g, ' ');
        if (name.length < 3) { setAuthMsg('اكتب اسمك (3 أحرف على الأقل).', false); return; }
        if (pass.length < 6) { setAuthMsg('كلمة المرور لازم تكون 6 أحرف أو أرقام على الأقل.', false); return; }
        if (pass !== document.getElementById('auth-pass2').value) { setAuthMsg('كلمتا المرور غير متطابقتين.', false); return; }
    }

    authBusy = true;
    const btn = document.getElementById('auth-submit');
    btn.disabled = true;
    setAuthMsg('جاري التحقق...', true);

    try {
        let cred;
        if (signup) {
            cred = await createUserWithEmailAndPassword(auth, email, pass);
            await updateProfile(cred.user, { displayName: name });
        } else {
            cred = await signInWithEmailAndPassword(auth, email, pass);
        }
        applyUser(cred.user, name);
        closeModal('auth-modal');
        setAuthMsg('', false);
        document.getElementById('auth-pass').value = '';
        document.getElementById('auth-pass2').value = '';
        showPage('home');
        showVerse(true);
    } catch (e) {
        setAuthMsg(authErrorText(e), false);
    }
    btn.disabled = false;
    authBusy = false;
}

async function resetPassword() {
    const email = document.getElementById('auth-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setAuthMsg('اكتب بريدك في خانة البريد أولاً ثم اضغط "نسيت كلمة المرور".', false); return; }
    try {
        await sendPasswordResetEmail(auth, email);
        setAuthMsg('تم إرسال رابط تغيير كلمة المرور إلى بريدك (راجع الـ Spam كمان).', true);
    } catch (e) {
        setAuthMsg(authErrorText(e), false);
    }
}

function applyUser(user, nameOverride) {
    const email = user.email || '';
    currentUser = {
        uid: user.uid,
        email: email,
        name: nameOverride || user.displayName || email.split('@')[0],
        isAdmin: ADMIN_EMAILS.indexOf(email.toLowerCase()) !== -1
    };
    updateUIForAuth();
}

onAuthStateChanged(auth, function(user) {
    if (user) {
        applyUser(user);
        if (firstAuthCheck) {
            showPage('home');
            if (!authBusy) showVerse(false);
        }
    } else {
        currentUser = null;
        updateUIForAuth();
        openAuthModal();
    }
    firstAuthCheck = false;
});

function updateUIForAuth() {
    const authBtnText = document.getElementById('auth-btn-text');
    const authBtn = document.getElementById('auth-btn');
    const userDisplay = document.getElementById('user-display');
    const adminControls = document.querySelectorAll('.admin-only');
    const adminNoticeControl = document.getElementById('admin-notice-control');

    if (currentUser) {
        if (authBtnText) authBtnText.innerText = 'خروج';
        if (authBtn) authBtn.onclick = logout;
        if (userDisplay) {
            userDisplay.innerText = currentUser.isAdmin ? '👑 أدمن' : '🎓 ' + currentUser.name;
            userDisplay.style.display = 'inline';
        }
        adminControls.forEach(el => el.style.display = currentUser.isAdmin ? 'flex' : 'none');
        if (adminNoticeControl) adminNoticeControl.style.display = currentUser.isAdmin ? 'block' : 'none';
        pomoShow(true);
    } else {
        pomoShow(false);
        if (authBtnText) authBtnText.innerText = 'تسجيل الدخول';
        if (authBtn) authBtn.onclick = openAuthModal;
        if (userDisplay) userDisplay.style.display = 'none';
        adminControls.forEach(el => el.style.display = 'none');
        if (adminNoticeControl) adminNoticeControl.style.display = 'none';
    }
}

// ==========================================================
//  آية قبل المذاكرة
// ==========================================================
const VERSES = [
    { t: 'وَقُل رَّبِّ زِدْنِي عِلْمًا', r: 'سورة طه - الآية 114' },
    { t: 'يَرْفَعِ اللَّهُ الَّذِينَ آمَنُوا مِنكُمْ وَالَّذِينَ أُوتُوا الْعِلْمَ دَرَجَاتٍ ۚ وَاللَّهُ بِمَا تَعْمَلُونَ خَبِيرٌ', r: 'سورة المجادلة - الآية 11' },
    { t: 'رَبِّ اشْرَحْ لِي صَدْرِي وَيَسِّرْ لِي أَمْرِي', r: 'سورة طه - الآيتان 25 و 26' },
    { t: 'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا إِنَّ مَعَ الْعُسْرِ يُسْرًا', r: 'سورة الشرح - الآيتان 5 و 6' },
    { t: 'اقْرَأْ بِاسْمِ رَبِّكَ الَّذِي خَلَقَ', r: 'سورة العلق - الآية 1' },
    { t: 'وَأَن لَّيْسَ لِلْإِنسَانِ إِلَّا مَا سَعَىٰ', r: 'سورة النجم - الآية 39' },
    { t: 'وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ ۚ إِنَّ اللَّهَ بَالِغُ أَمْرِهِ', r: 'سورة الطلاق - الآية 3' },
    { t: 'لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا', r: 'سورة البقرة - الآية 286' },
    { t: 'وَقُلِ اعْمَلُوا فَسَيَرَى اللَّهُ عَمَلَكُمْ وَرَسُولُهُ وَالْمُؤْمِنُونَ', r: 'سورة التوبة - الآية 105' },
    { t: 'إِنَّمَا يَخْشَى اللَّهَ مِنْ عِبَادِهِ الْعُلَمَاءُ', r: 'سورة فاطر - الآية 28' }
];

function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function showVerse(force) {
    if (!currentUser) return;
    try {
        if (!force && localStorage.getItem('kh_verse_day') === todayKey()) return;
        localStorage.setItem('kh_verse_day', todayKey());
    } catch (e) {}
    const v = VERSES[Math.floor(Math.random() * VERSES.length)];
    const t = document.getElementById('verse-text');
    const r = document.getElementById('verse-ref');
    if (t) t.innerText = '﴿ ' + v.t + ' ﴾';
    if (r) r.innerText = v.r;
    const m = document.getElementById('verse-modal');
    if (m) m.style.display = 'flex';
}

function closeVerse() {
    const m = document.getElementById('verse-modal');
    if (m) m.style.display = 'none';
}

// ==========================================================
//  مؤقت المذاكرة (25 دقيقة مذاكرة / 5 دقائق راحة)
// ==========================================================
const POMO_STUDY = 25 * 60 * 1000;
const POMO_BREAK = 5 * 60 * 1000;
let pomo = { mode: 'study', endAt: null, left: POMO_STUDY };
let pomoTimer = null;
let audioCtx = null;

try {
    const sv = JSON.parse(localStorage.getItem('kh_pomo') || 'null');
    if (sv && (sv.mode === 'study' || sv.mode === 'break')) pomo = sv;
} catch (e) {}

function pomoSave() {
    try { localStorage.setItem('kh_pomo', JSON.stringify(pomo)); } catch (e) {}
}

function pomoTotal() { return pomo.mode === 'study' ? POMO_STUDY : POMO_BREAK; }

function pomoRemaining() {
    return pomo.endAt ? Math.max(0, pomo.endAt - Date.now()) : pomo.left;
}

function fmt(ms) {
    const sec = Math.ceil(ms / 1000);
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function pomoRender() {
    const rem = pomoRemaining();
    const isBreak = pomo.mode === 'break';
    const set = function(id, fn) { const el = document.getElementById(id); if (el) fn(el); };
    set('pomo-time', function(el) { el.innerText = fmt(rem); });
    set('pomo-mini', function(el) { el.innerText = fmt(rem); });
    set('pomo-mode', function(el) {
        el.innerText = isBreak ? 'وقت الراحة ☕' : 'وقت المذاكرة 📚';
        el.classList.toggle('break', isBreak);
    });
    set('pomo-fab', function(el) { el.classList.toggle('break', isBreak); });
    set('pomo-bar-fill', function(el) {
        el.style.width = (100 - (rem / pomoTotal()) * 100) + '%';
        el.classList.toggle('break', isBreak);
    });
    set('pomo-start', function(el) { el.innerText = pomo.endAt ? 'إيقاف مؤقت' : 'ابدأ'; });
    if (pomo.endAt) document.title = fmt(rem) + (isBreak ? ' راحة' : ' مذاكرة') + ' | الخلاصة';
    else document.title = 'الخلاصة | Top Notes - كلية التجارة';
}

function pomoBeep() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        [0, 0.35, 0.7].forEach(function(delay) {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'sine';
            o.frequency.value = 880;
            o.connect(g); g.connect(audioCtx.destination);
            const t0 = audioCtx.currentTime + delay;
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
            o.start(t0); o.stop(t0 + 0.32);
        });
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) {}
}

function pomoToast(msg) {
    const el = document.getElementById('pomo-toast');
    if (!el) return;
    el.innerText = msg;
    el.classList.add('show');
    setTimeout(function() { el.classList.remove('show'); }, 6000);
}

function pomoTick() {
    if (!pomo.endAt) return;
    if (Date.now() >= pomo.endAt) {
        // انتهت الفترة: صوت وتنبيه وبدء الفترة التالية تلقائياً
        const wasStudy = pomo.mode === 'study';
        pomo.mode = wasStudy ? 'break' : 'study';
        pomo.endAt = Date.now() + pomoTotal();
        pomoSave();
        pomoBeep();
        pomoToast(wasStudy ? 'خلصت 25 دقيقة مذاكرة 👏 خد راحة 5 دقائق' : 'الراحة خلصت 💪 يلا نكمل مذاكرة');
    }
    pomoRender();
}

function pomoStartLoop() {
    if (pomoTimer) clearInterval(pomoTimer);
    pomoTimer = setInterval(pomoTick, 500);
}

function pomoToggle() {
    if (pomo.endAt) {
        pomo.left = pomoRemaining();
        pomo.endAt = null;
        if (pomoTimer) { clearInterval(pomoTimer); pomoTimer = null; }
    } else {
        // الضغطة دي بتفتح الصوت في المتصفح
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) {}
        pomo.endAt = Date.now() + pomo.left;
        pomoStartLoop();
    }
    pomoSave();
    pomoRender();
}

function pomoReset() {
    pomo = { mode: 'study', endAt: null, left: POMO_STUDY };
    if (pomoTimer) { clearInterval(pomoTimer); pomoTimer = null; }
    pomoSave();
    pomoRender();
}

function pomoSkip() {
    const running = !!pomo.endAt;
    pomo.mode = pomo.mode === 'study' ? 'break' : 'study';
    pomo.left = pomoTotal();
    pomo.endAt = running ? Date.now() + pomo.left : null;
    pomoSave();
    pomoRender();
}

function pomoPanel() {
    const el = document.getElementById('pomo');
    if (el) el.classList.toggle('open');
}

function pomoShow(on) {
    const el = document.getElementById('pomo');
    if (!el) return;
    el.classList.toggle('on', !!on);
    if (!on) {
        el.classList.remove('open');
        pomoReset();
        return;
    }
    pomoRender();
    if (pomo.endAt) pomoStartLoop();
}

async function logout() {
    stopQuizTimer();
    try { await signOut(auth); } catch (e) { console.error(e); }
    try { localStorage.removeItem('kholasa_currentUser'); } catch (e) {}
}

function timeAgo(timestamp) {
    const ts = Number(timestamp);
    if (isNaN(ts)) return 'منذ فترة';
    const seconds = Math.floor((new Date() - ts) / 1000);
    if (seconds < 60) return 'منذ ثوانٍ قليلة';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return 'منذ ' + minutes + ' دقيقة';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return 'منذ ' + hours + ' ساعة';
    const days = Math.floor(hours / 24);
    return 'منذ ' + days + ' يوم';
}

// زرار "تحديث الموقع الآن": بيمسح التخزين المؤقت ويجيب أحدث بيانات
async function triggerUpdateProcess() {
    const banner = document.getElementById('update-progress-banner');
    const fill = document.getElementById('progress-bar-fill');
    if (banner) banner.style.display = 'block';
    if (fill) fill.style.width = '30%';

    cacheClear();
    await syncLectureCount();
    await loadDataFromCloud(true);
    updateStats();

    try {
        const activePage = document.querySelector('.page.active');
        if (activePage) {
            if (activePage.id === 'subject-detail' && currentSubjectId) {
                await loadLecturesOf(currentSubjectId, true);
                renderLectures();
            } else if (activePage.id === 'quizzes') {
                await loadQuizzes(true);
                renderQuizzes();
            } else if (activePage.id === 'antizam') {
                renderSubjects('انتظام');
            } else if (activePage.id === 'antisab') {
                renderSubjects('انتساب');
            }
        }
    } catch (e) {
        console.error("Update error:", e);
    }

    if (fill) fill.style.width = '100%';
    setTimeout(function() {
        if (banner) banner.style.display = 'none';
        if (fill) fill.style.width = '0%';
    }, 800);
}

function renderSubjects(track) {
    currentTrack = track;
    const grid = document.getElementById(track === 'انتظام' ? 'antizam-grid' : 'antisab-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const sid = track === 'انتظام' ? 'search-antizam' : 'search-antisab';
    const trackSubjects = subjects.filter(s => s.track === track && matchSearch(s.name, sid));

    if (trackSubjects.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:2rem;">لا توجد مواد مطابقة.</p>';
        return;
    }

    trackSubjects.forEach(sub => {
        const card = document.createElement('div');
        card.className = 'subject-card';
        let deleteBtn = '';
        if (currentUser && currentUser.isAdmin) {
            deleteBtn = '<button class="delete-btn" onclick="deleteSubject(event, \'' + sub.id + '\')"><i class="fa-solid fa-trash"></i></button>';
        }
        card.innerHTML = deleteBtn +
            '<div class="subject-icon-box"><i class="fa-solid fa-book-bookmark"></i></div>' +
            '<h3>' + sub.name + '</h3>' +
            '<span class="time-ago">تمت الإضافة ' + timeAgo(sub.createdAt || sub.id) + '</span>' +
            '<span style="color:var(--primary-gold); font-size:0.85rem; margin-top:0.4rem; font-weight:bold;">تصفح المحتوى ←</span>';
        card.onclick = function() { openSubjectDetail(sub); };
        grid.appendChild(card);
    });
}

function openAddSubjectModal(track) {
    currentTrack = track;
    const input = document.getElementById('new-subject-name');
    if (input) input.value = '';
    const modal = document.getElementById('subject-modal');
    if (modal) modal.style.display = 'flex';
}

async function saveSubject() {
    const nameInput = document.getElementById('new-subject-name');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) return;

    const subId = String(Date.now());
    const newSub = { track: currentTrack, name: name, createdAt: Date.now() };

    try {
        await setDoc(doc(db, "subjects", subId), newSub);
        cacheClear();
        closeModal('subject-modal');
        await loadDataFromCloud();
        renderSubjects(currentTrack);
    } catch (e) {
        console.error("Error saving subject", e);
        alert('حدث خطأ أثناء حفظ المادة: ' + e.message);
    }
}

async function deleteSubject(e, id) {
    e.stopPropagation();
    try {
        await deleteDoc(doc(db, "subjects", String(id)));
        cacheClear();
        await loadDataFromCloud();
        renderSubjects(currentTrack);
    } catch (e) {
        console.error("Error deleting subject", e);
    }
}

async function openSubjectDetail(sub) {
    currentSubjectId = sub.id;
    const titleEl = document.getElementById('current-subject-title');
    const nameBar = document.getElementById('current-subject-name-bar');
    if (titleEl) titleEl.innerText = sub.name;
    if (nameBar) nameBar.innerText = sub.name;
    
    const ls = document.getElementById('search-lectures'); if (ls) ls.value = '';
    showPage('subject-detail');

    const list = document.getElementById('lectures-list');
    if (list) {
        list.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:2rem;">جاري التحميل...</p>';
    }

    try {
        await loadLecturesOf(sub.id);
    } catch (e) {
        console.error("Lectures load error:", e);
        lectures = [];
    }
    renderLectures();
}

function goBackToTrack() {
    showPage(currentTrack === 'انتظام' ? 'antizam' : 'antisab');
}

let editingLectureId = null;

function openAddLectureModal() {
    editingLectureId = null;
    document.getElementById('lecture-modal-title').innerText = 'إضافة محاضرة جديدة';
    document.getElementById('saveLectureBtn').innerText = 'حفظ ونشر المحاضرة';
    document.getElementById('new-lecture-title').value = '';
    document.getElementById('lecture-images').value = '';
    document.getElementById('lecture-files').value = '';
    document.getElementById('lecture-existing').innerHTML = '';
    document.getElementById('lecture-links').innerHTML = '';
    addLinkRow();
    document.getElementById('lecture-modal').style.display = 'flex';
}

function openEditLecture(e, id) {
    if (e) e.stopPropagation();
    const lec = lectures.find(function(l) { return String(l.id) === String(id); });
    if (!lec) return;
    editingLectureId = lec.id;
    document.getElementById('lecture-modal-title').innerText = 'تعديل المحاضرة';
    document.getElementById('saveLectureBtn').innerText = 'حفظ التعديلات';
    document.getElementById('new-lecture-title').value = lec.title || '';
    document.getElementById('lecture-images').value = '';
    document.getElementById('lecture-files').value = '';

    let ex = '';
    [['images', 'الصور الحالية'], ['files', 'الملفات الحالية'], ['videos', 'فيديوهات مرفوعة']].forEach(function(k) {
        const arr = lec[k[0]] || [];
        if (!arr.length) return;
        ex += '<div class="existing-box"><b style="font-size:0.85rem;">' + k[1] + ' (علّم على اللي عايز تحذفه)</b>';
        arr.forEach(function(it, i) {
            ex += '<label class="existing-item"><input type="checkbox" data-kind="' + k[0] + '" data-i="' + i + '"> حذف: ' + esc(it.name) + '</label>';
        });
        ex += '</div>';
    });
    document.getElementById('lecture-existing').innerHTML = ex;

    const box = document.getElementById('lecture-links');
    box.innerHTML = '';
    (lec.links || []).forEach(function(lk) { addLinkRow(lk); });
    addLinkRow();
    document.getElementById('lecture-modal').style.display = 'flex';
}

function addLinkRow(data) {
    const box = document.getElementById('lecture-links');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; flex-direction:column; gap:0.3rem; margin-bottom:0.6rem; padding:0.5rem; border:1px dashed var(--card-border); border-radius:8px;';
    row.innerHTML = '<input type="text" class="lk-title" placeholder="اسم الفيديو (مثال: شرح الفصل الأول)">' +
        '<input type="url" class="lk-url" placeholder="https://youtu.be/... (امسحه لو عايز تشيل الرابط)" dir="ltr">';
    if (data) {
        row.querySelector('.lk-title').value = data.name || '';
        row.querySelector('.lk-url').value = data.url || '';
    }
    box.appendChild(row);
}

function collectLinks() {
    const out = [];
    document.querySelectorAll('#lecture-links > div').forEach(function(row) {
        let url = row.querySelector('.lk-url').value.trim();
        const title = row.querySelector('.lk-title').value.trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        out.push({ name: title || 'فيديو الشرح', url: url });
    });
    return out;
}

function lectureOrderValue(l) {
    if (typeof l.order === 'number') return l.order;
    return Number(l.createdAt) || Number(l.id) || 0;
}

function sortedLecturesOfSubject() {
    return lectures
        .filter(function(l) { return String(l.subjectId) === String(currentSubjectId); })
        .sort(function(a, b) { return lectureOrderValue(a) - lectureOrderValue(b); });
}

async function moveLecture(e, id, dir) {
    e.stopPropagation();
    const list = sortedLecturesOfSubject();
    const i = list.findIndex(function(l) { return String(l.id) === String(id); });
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const t = list[i]; list[i] = list[j]; list[j] = t;
    const changed = [];
    list.forEach(function(l, k) {
        if (l.order !== k * 10) { l.order = k * 10; changed.push(l); }
    });
    renderLectures();
    try {
        for (let n = 0; n < changed.length; n++) {
            await setDoc(doc(db, 'lectures', String(changed[n].id)), { order: changed[n].order }, { merge: true });
        }
        cacheSet('lec_' + currentSubjectId, lectures);
    } catch (err) {
        console.error('Move error', err);
        alert('تعذر حفظ الترتيب: ' + err.message);
    }
}

// ===== إعدادات Cloudinary =====
const CLOUD_NAME = 'flilvppv';
const UPLOAD_PRESET = 'kholasa';

async function uploadToCloudinary(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    const res = await fetch('https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/auto/upload', {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ? data.error.message : 'فشل الرفع');
    return data.secure_url;
}

async function uploadFiles(files, folder, lectureId) {
    const result = [];
    for (let i = 0; i < files.length; i++) {
        const url = await uploadToCloudinary(files[i]);
        result.push({ name: files[i].name, data: url });
    }
    return result;
}

let isSavingLecture = false;

async function saveLectureData() {
    if (isSavingLecture) return;

    const title = document.getElementById('new-lecture-title').value.trim();
    if (!title) {
        alert('من فضلك اكتب عنوان المحاضرة');
        return;
    }

    const btn = document.getElementById('saveLectureBtn');
    isSavingLecture = true;
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'جاري الرفع... لا تغلق الصفحة';
    }

    const lectureId = String(Date.now());

    try {
        const newImages = await uploadFiles(document.getElementById('lecture-images').files, 'images', lectureId);
        const links = collectLinks();
        const newFiles = await uploadFiles(document.getElementById('lecture-files').files, 'files', lectureId);

        if (editingLectureId) {
            const lec = lectures.find(function(l) { return String(l.id) === String(editingLectureId); }) || {};
            const keep = function(kind) {
                const drop = {};
                document.querySelectorAll('#lecture-existing input[data-kind="' + kind + '"]:checked').forEach(function(c) { drop[c.dataset.i] = true; });
                return (lec[kind] || []).filter(function(_, i) { return !drop[i]; });
            };
            await setDoc(doc(db, 'lectures', String(editingLectureId)), {
                title: title,
                images: keep('images').concat(newImages),
                files: keep('files').concat(newFiles),
                videos: keep('videos'),
                links: links
            }, { merge: true });
            cacheClear();
            closeModal('lecture-modal');
            editingLectureId = null;
            await loadLecturesOf(currentSubjectId, true);
            renderLectures();
            return;
        }

        const images = newImages;
        const files = newFiles;

        await setDoc(doc(db, "lectures", lectureId), {
            subjectId: String(currentSubjectId),
            title: title,
            images: images,
            links: links,
            files: files,
            order: Date.now(),
            createdAt: Date.now()
        });

        await syncLectureCount(1);
        cacheClear();
        closeModal('lecture-modal');
        await loadDataFromCloud();
        await loadLecturesOf(currentSubjectId);
        renderLectures();
        updateStats();
    } catch (e) {
        console.error("Error saving lecture", e);
        alert('حدث خطأ أثناء الحفظ: ' + e.message);
    } finally {
        isSavingLecture = false;
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'حفظ ونشر المحاضرة';
        }
    }
}

function renderLectures() {
    const list = document.getElementById('lectures-list');
    if (!list) return;
    list.innerHTML = '';

    const all = sortedLecturesOfSubject();
    const searching = !!(document.getElementById('search-lectures') || {}).value;
    const subLectures = all.filter(function(l) { return matchSearch(l.title, 'search-lectures'); });
    const isAdmin = !!(currentUser && currentUser.isAdmin);

    // شريط التقدم
    const prog = document.getElementById('subject-progress');
    if (prog) {
        if (all.length && !isAdmin) {
            const done = all.filter(function(l) { return isStudied(l.id); }).length;
            const pct = Math.round(done / all.length * 100);
            prog.style.display = 'block';
            prog.innerHTML = 'تقدمك في المادة: ' + done + ' من ' + all.length + ' (' + pct + '%)<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>';
        } else {
            prog.style.display = 'none';
        }
    }

    if (subLectures.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:2rem;">' + (searching ? 'لا توجد محاضرات مطابقة.' : 'لا توجد محاضرات مضافة لهذه المادة بعد.') + '</p>';
        return;
    }

    subLectures.forEach(function(lec, idx) {
        const card = document.createElement('div');
        card.className = 'subject-card';
        let tools = '';
        if (isAdmin) {
            tools = '<button class="delete-btn" onclick="deleteLecture(event, \'' + lec.id + '\')"><i class="fa-solid fa-trash"></i></button>' +
                '<div class="card-tools">' +
                '<button class="card-tool" title="تعديل" onclick="openEditLecture(event, \'' + lec.id + '\')"><i class="fa-solid fa-pen"></i></button>' +
                (searching ? '' :
                    '<button class="card-tool" title="قدّم" onclick="moveLecture(event, \'' + lec.id + '\', -1)"' + (idx === 0 ? ' disabled style="opacity:.3"' : '') + '><i class="fa-solid fa-arrow-up"></i></button>' +
                    '<button class="card-tool" title="أخّر" onclick="moveLecture(event, \'' + lec.id + '\', 1)"' + (idx === subLectures.length - 1 ? ' disabled style="opacity:.3"' : '') + '><i class="fa-solid fa-arrow-down"></i></button>') +
                '</div>';
        }
        card.innerHTML = tools +
            '<div class="subject-icon-box"><i class="fa-solid fa-file-lines"></i></div>' +
            '<h3>' + lec.title + '</h3>' +
            '<span class="time-ago">تمت الإضافة ' + timeAgo(lec.createdAt || lec.id) + '</span>' +
            (!isAdmin && isStudied(lec.id) ? '<span class="done-badge">✅ تمت مذاكرتها</span>' : '') +
            '<span style="color:var(--primary-gold); font-size:0.85rem; margin-top:0.4rem; font-weight:bold;">فتح المحاضرة ←</span>';
        card.onclick = function() { openLectureDetail(lec); };
        list.appendChild(card);
    });
}

async function deleteLecture(e, id) {
    e.stopPropagation();
    try {
        await deleteDoc(doc(db, "lectures", String(id)));
        await syncLectureCount(-1);
        cacheClear();
        await loadDataFromCloud();
        await loadLecturesOf(currentSubjectId);
        renderLectures();
        updateStats();
    } catch (e) {
        console.error("Error deleting lecture", e);
    }
}

function openLectureDetail(lec) {
    currentLectureId = lec.id;
    document.getElementById('current-lecture-title').innerText = lec.title;
    showPage('lecture-detail');

    const contentList = document.getElementById('lecture-content-list');
    contentList.innerHTML = '';
    currentMediaData = lec;

    let htmlContent = '';

    if (currentUser && !currentUser.isAdmin) {
        const on = isStudied(lec.id);
        htmlContent += '<button id="studied-btn" class="studied-btn' + (on ? ' on' : '') + '" onclick="toggleStudied(\'' + lec.id + '\')">' + (on ? '✅ تمت مذاكرتها' : 'علّم كمتذاكرة ✓') + '</button>';
    }

    if (lec.images && lec.images.length > 0) {
        htmlContent += '<h3 style="color:var(--primary-gold); margin-bottom:1rem;"><i class="fa-solid fa-image"></i> الصور المرفقة (' + lec.images.length + ')</h3>';
        htmlContent += '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:1rem; margin-bottom:2rem;">';
        for (let i = 0; i < lec.images.length; i++) {
            const img = lec.images[i];
            htmlContent += '<div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:0.8rem; text-align:center;">';
            htmlContent += '<img src="' + img.data + '" alt="' + img.name + '" style="width:100%; height:140px; border-radius:8px; object-fit:cover; margin-bottom:0.8rem;">';
            htmlContent += '<button onclick="viewMedia(\'image\', ' + i + ', \'images\')" style="background:var(--accent-cyan); color:#000; border:none; padding:0.4rem 0.8rem; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.8rem; width:100%;"><i class="fa-solid fa-eye"></i> مشاهدة مباشرة</button>';
            htmlContent += '</div>';
        }
        htmlContent += '</div>';
    }

    if (lec.links && lec.links.length > 0) {
        htmlContent += '<h3 style="color:var(--primary-gold); margin-bottom:1rem;"><i class="fa-brands fa-youtube"></i> فيديوهات الشرح (' + lec.links.length + ')</h3>';
        htmlContent += '<div style="display:flex; flex-direction:column; gap:0.8rem; margin-bottom:2rem;">';
        for (let i = 0; i < lec.links.length; i++) {
            const lk = lec.links[i];
            htmlContent += '<a href="' + esc(lk.url) + '" target="_blank" rel="noopener noreferrer" style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:1rem; display:flex; justify-content:space-between; align-items:center; gap:0.5rem; text-decoration:none; color:var(--text-main);">';
            htmlContent += '<span style="font-weight:bold;">' + esc(lk.name) + '</span>';
            htmlContent += '<span style="background:var(--accent-cyan); color:#000; padding:0.4rem 0.9rem; border-radius:6px; font-weight:bold; font-size:0.8rem; white-space:nowrap;"><i class="fa-solid fa-play"></i> مشاهدة</span>';
            htmlContent += '</a>';
        }
        htmlContent += '</div>';
    }

    // فيديوهات قديمة مرفوعة على الموقع (لو موجودة)
    if (lec.videos && lec.videos.length > 0) {
        htmlContent += '<h3 style="color:var(--primary-gold); margin-bottom:1rem;"><i class="fa-solid fa-video"></i> فيديوهات مرفوعة (' + lec.videos.length + ')</h3>';
        htmlContent += '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:1rem; margin-bottom:2rem;">';
        for (let i = 0; i < lec.videos.length; i++) {
            const vid = lec.videos[i];
            htmlContent += '<div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:0.8rem; text-align:center;">';
            htmlContent += '<p style="font-weight:bold; margin-bottom:0.6rem; font-size:0.9rem;">' + esc(vid.name) + '</p>';
            htmlContent += '<button onclick="viewMedia(\'video\', ' + i + ', \'videos\')" style="background:var(--accent-cyan); color:#000; border:none; padding:0.4rem 0.9rem; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.8rem; width:100%;"><i class="fa-solid fa-play"></i> مشاهدة مباشرة</button>';
            htmlContent += '</div>';
        }
        htmlContent += '</div>';
    }

    if (lec.files && lec.files.length > 0) {
        htmlContent += '<h3 style="color:var(--primary-gold); margin-bottom:1rem;"><i class="fa-solid fa-file"></i> الملفات والـ PDF (' + lec.files.length + ')</h3>';
        htmlContent += '<div style="display:flex; flex-direction:column; gap:0.8rem; margin-bottom:2rem;">';
        for (let i = 0; i < lec.files.length; i++) {
            const file = lec.files[i];
            htmlContent += '<div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">';
            htmlContent += '<span style="font-weight:bold;">' + file.name + '</span>';
            htmlContent += '<button onclick="viewMedia(\'pdf\', ' + i + ', \'files\')" style="background:var(--accent-cyan); color:#000; border:none; padding:0.4rem 0.9rem; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.8rem;"><i class="fa-solid fa-eye"></i> معاينة بالموقع</button>';
            htmlContent += '</div>';
        }
        htmlContent += '</div>';
    }

    if (!htmlContent) {
        htmlContent = '<p style="color:var(--text-muted); text-align:center; padding:2rem;">لا توجد محتويات مرفقة في هذه المحاضرة.</p>';
    }

    contentList.innerHTML = htmlContent;
}

function viewMedia(type, index, mediaType) {
    if (!currentMediaData || !currentMediaData[mediaType] || !currentMediaData[mediaType][index]) return;

    const item = currentMediaData[mediaType][index];
    const modal = document.getElementById('media-view-modal');
    const title = document.getElementById('media-modal-title');
    const body = document.getElementById('media-modal-body');

    title.innerText = item.name;
    body.innerHTML = '';

    if (type === 'image') {
        body.innerHTML = '<img src="' + item.data + '" alt="' + item.name + '" draggable="false" style="width:100%; max-height:70vh; object-fit:contain; border-radius:8px; pointer-events:none;">';
    } else if (type === 'video') {
        body.innerHTML = '<video controls autoplay controlsList="nodownload noremoteplayback" disablePictureInPicture oncontextmenu="return false" src="' + item.data + '" style="width:100%; max-height:70vh; border-radius:8px;"></video>';
    } else if (type === 'pdf') {
        showPdfAsImages(item, body);
    }

    modal.style.display = 'flex';
}

function showPdfAsImages(item, body) {
    const url = item.data;
    // العلامة المائية للطلاب فقط، والأدمن مفيش عليه علامة
    const showMark = !!(currentUser && !currentUser.isAdmin);
    const email = showMark ? currentUser.email : '';

    // لو الملف مش PDF على Cloudinary، نعرضه بشكل عادي
    if (!(url.indexOf('/image/upload/') !== -1 && /\.pdf($|\?)/i.test(url))) {
        body.innerHTML = '<iframe src="https://docs.google.com/gview?embedded=true&url=' + encodeURIComponent(url) + '" style="width:100%; height:70vh; border:none; border-radius:8px; background:#fff;"></iframe>';
        return;
    }

    const base = url.replace('/image/upload/', '/image/upload/pg_PAGE/').replace(/\.pdf($|\?.*)/i, '.jpg');

    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.userSelect = 'none';
    wrapper.style.webkitTouchCallout = 'none';
    wrapper.oncontextmenu = function() { return false; };

    const pages = document.createElement('div');
    wrapper.appendChild(pages);

    // علامة مائية بإيميل الطالب (مش بتظهر للأدمن)
    if (showMark) {
        const safeEmail = email.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><text x='20' y='110' fill='rgba(120,120,120,0.28)' font-size='16' font-family='Arial' transform='rotate(-25 160 100)'>" + safeEmail + "</text></svg>";
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:absolute; inset:0; pointer-events:none; background-repeat:repeat; background-image:url("data:image/svg+xml,' + encodeURIComponent(svg) + '");';
        wrapper.appendChild(overlay);
    }

    body.appendChild(wrapper);

    let page = 1;
    function loadNext() {
        if (page > 150) return;
        const img = new Image();
        img.draggable = false;
        img.style.cssText = 'width:100%; display:block; margin-bottom:8px; border-radius:6px; pointer-events:none;';
        img.onload = function() {
            pages.appendChild(img);
            page++;
            loadNext();
        };
        img.onerror = function() {
            if (page === 1) {
                pages.innerHTML = '<p style="padding:1rem;">تعذر عرض الملف</p>';
            }
        };
        img.src = base.replace('PAGE', page);
    }
    loadNext();
}

function goBackToSubject() {
    const sub = subjects.find(s => s.id === currentSubjectId);
    if (sub) openSubjectDetail(sub);
}

// ==========================================================
//  بنك الأسئلة
// ==========================================================
function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TYPE_LABEL = { tf: 'صح وغلط', mcq: 'اختيار من متعدد', essay: 'مقالي' };

function qType(quiz, q) { return q.type || quiz.type || 'mcq'; }

let quizRun = null;       // محاولة الحل الحالية
let quizWrong = [];       // الأسئلة اللي الطالب غلط فيها في آخر محاولة مصححة
let quizTimerId = null;

function renderQuizzes() {
    const grid = document.getElementById('quizzes-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (quizzes.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:2rem;">لا يوجد اختبارات مضافة بعد.</p>';
        return;
    }

    const shownQuizzes = quizzes.filter(function(q) { return matchSearch(q.title, 'search-quizzes'); });
    if (shownQuizzes.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:2rem;">لا توجد اختبارات مطابقة.</p>';
        return;
    }
    shownQuizzes.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'subject-card';
        let deleteBtn = '';
        if (currentUser && currentUser.isAdmin) {
            deleteBtn = '<button class="delete-btn" onclick="deleteQuiz(event, \'' + quiz.id + '\')"><i class="fa-solid fa-trash"></i></button>';
        }
        const n = (quiz.questions || []).length;
        const timeTxt = quiz.timeLimit > 0 ? ' • ⏱ ' + quiz.timeLimit + ' دقيقة' : '';
        card.innerHTML = deleteBtn +
            '<div class="subject-icon-box"><i class="fa-solid fa-pen-to-square"></i></div>' +
            '<h3>' + esc(quiz.title) + '</h3>' +
            '<span class="time-ago">' + n + ' سؤال' + timeTxt + '</span>' +
            '<span class="time-ago">تمت الإضافة ' + timeAgo(quiz.createdAt || quiz.id) + '</span>' +
            '<span style="color:var(--primary-gold); font-size:0.85rem; margin-top:0.4rem; font-weight:bold;">دخول للاختبار ←</span>';
        card.onclick = function() { openQuizStart(quiz); };
        grid.appendChild(card);
    });
}

// ---------- بناء الاختبار (للأدمن) ----------
function openAddQuizModal() {
    document.getElementById('quiz-title-input').value = '';
    document.getElementById('quiz-time-input').value = '0';
    const imgInput = document.getElementById('quiz-image-input');
    if (imgInput) imgInput.value = '';
    document.getElementById('quiz-builder-area').innerHTML = '';
    document.getElementById('quiz-import-text').value = '';
    document.getElementById('quiz-import-msg').innerText = '';
    builderQuestions = [];
    addQuestionField();
    document.getElementById('quiz-modal').style.display = 'flex';
}

function renumberBuilder() {
    const boxes = document.querySelectorAll('#quiz-builder-area .qb');
    boxes.forEach(function(b, i) {
        b.querySelector('.qb-num').innerText = 'سؤال ' + (i + 1) + ' — ' + TYPE_LABEL[b.dataset.type];
    });
    const c = document.getElementById('quiz-q-count');
    if (c) c.innerText = boxes.length;
}

function addQuestionField(data) {
    const area = document.getElementById('quiz-builder-area');
    const type = (data && data.type) ? data.type : document.getElementById('new-q-type').value;

    const box = document.createElement('div');
    box.className = 'qb';
    box.dataset.type = type;

    let inner = '<div class="qb-head"><b class="qb-num"></b>' +
        '<button type="button" class="qb-del" title="حذف السؤال">✕</button></div>' +
        '<div class="form-group" style="margin-bottom:0.5rem;"><textarea class="q-text" rows="2" placeholder="نص السؤال"></textarea></div>';

    if (type === 'tf') {
        inner += '<div class="form-group" style="margin-bottom:0.3rem;"><label>الإجابة الصحيحة</label><select class="q-correct"><option value="صح">صح ✅</option><option value="غلط">غلط ❌</option></select></div>';
    } else if (type === 'mcq') {
        const n = Math.max(4, data && data.options ? data.options.length : 4);
        let opts = '', sel = '';
        for (let i = 1; i <= n; i++) {
            opts += '<input type="text" class="q-opt" placeholder="الخيار ' + i + '" style="margin-bottom:0.3rem;">';
            sel += '<option value="' + i + '">' + i + '</option>';
        }
        inner += opts + '<div class="form-group" style="margin:0.3rem 0 0;"><label>رقم الإجابة الصحيحة</label><select class="q-correct">' + sel + '</select></div>';
    } else {
        inner += '<div class="form-group" style="margin-bottom:0.3rem;"><label>الإجابة النموذجية (للمراجعة)</label><textarea class="q-correct" rows="2" placeholder="الإجابة النموذجية"></textarea></div>';
    }
    box.innerHTML = inner;

    if (data) {
        box.querySelector('.q-text').value = data.text || '';
        if (type === 'mcq') {
            box.querySelectorAll('.q-opt').forEach(function(el, i) { el.value = (data.options && data.options[i]) || ''; });
        }
        const c = box.querySelector('.q-correct');
        if (c && data.correct != null) c.value = data.correct;
    }

    box.querySelector('.qb-del').onclick = function() { box.remove(); renumberBuilder(); };
    area.appendChild(box);
    builderQuestions.push(box);
    renumberBuilder();
    if (!data) {
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        box.querySelector('.q-text').focus();
    }
}

// ---------- استيراد أسئلة من نص ----------
const LETTER_IDX = { 'أ': 0, 'ا': 0, 'a': 0, 'A': 0, '1': 0, 'ب': 1, 'b': 1, 'B': 1, '2': 1, 'ج': 2, 'c': 2, 'C': 2, '3': 2, 'د': 3, 'd': 3, 'D': 3, '4': 3, 'هـ': 4, 'ه': 4, 'e': 4, 'E': 4, '5': 4, 'و': 5, 'f': 5, 'F': 5, '6': 5 };

function parseImportText(text) {
    const result = [];
    const errors = [];
    const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map(function(b) { return b.trim(); }).filter(Boolean);

    blocks.forEach(function(block, bi) {
        const lines = block.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
        let type = null;
        let qText = '', options = [], answer = '';
        let mode = '';

        lines.forEach(function(line) {
            let m;
            if ((m = line.match(/^\[(.+?)\]\s*(.*)$/)) && !qText && options.length === 0) {
                const tag = m[1].trim();
                if (/صح|غلط|tf|true/i.test(tag)) type = 'tf';
                else if (/مقال|essay/i.test(tag)) type = 'essay';
                else if (/اختيار|mcq|متعدد/i.test(tag)) type = 'mcq';
                if (m[2]) { qText = m[2]; mode = 'q'; }
                return;
            }
            if ((m = line.match(/^(?:السؤال|سؤال|س|Q|Question)\s*\d*\s*[:：\-\.]\s*(.*)$/i))) { qText = m[1]; mode = 'q'; return; }
            if ((m = line.match(/^(?:الإجابة|الاجابة|الإجابه|الاجابه|إجابة|اجابة|Answer|Ans)\s*[:：\-]\s*(.*)$/i))) { answer = m[1].trim(); mode = 'a'; return; }
            if (qText && (m = line.match(/^(أ|ا|ب|ج|د|هـ|ه|و|[A-Fa-f]|[1-6])\s*[:：\)\.\-]\s*(.+)$/)) && mode !== 'a') {
                options[LETTER_IDX[m[1]] != null ? LETTER_IDX[m[1]] : options.length] = m[2].trim();
                mode = 'o';
                return;
            }
            if (mode === 'q') qText += ' ' + line;
            else if (mode === 'a') answer += ' ' + line;
            else if (mode === 'o' && options.length) options[options.length - 1] += ' ' + line;
            else if (!qText) { qText = line; mode = 'q'; }
        });

        options = options.filter(function(o) { return o != null && o !== ''; });
        qText = qText.trim();

        if (!qText) { errors.push(bi + 1); return; }

        if (!type) {
            if (options.length >= 2) type = 'mcq';
            else if (/^(صح|غلط|خطأ|خطا|true|false|✓|✗)/i.test(answer)) type = 'tf';
            else type = 'essay';
        }

        if (type === 'tf') {
            if (/^(صح|true|✓|صحيح)/i.test(answer)) answer = 'صح';
            else if (/^(غلط|خطأ|خطا|false|✗|خاطئ)/i.test(answer)) answer = 'غلط';
            else { errors.push(bi + 1); return; }
            result.push({ type: 'tf', text: qText, correct: answer, options: [] });
        } else if (type === 'mcq') {
            if (options.length < 2) { errors.push(bi + 1); return; }
            let idx = -1;
            const a = answer.replace(/[\s\)\.]/g, '');
            if (LETTER_IDX[a] != null) idx = LETTER_IDX[a];
            else {
                idx = options.findIndex(function(o) { return o.trim() === answer.trim(); });
            }
            if (idx < 0 || idx >= options.length) { errors.push(bi + 1); return; }
            result.push({ type: 'mcq', text: qText, correct: String(idx + 1), options: options });
        } else {
            result.push({ type: 'essay', text: qText, correct: answer, options: [] });
        }
    });

    return { questions: result, errors: errors };
}

function importQuestions() {
    const ta = document.getElementById('quiz-import-text');
    const msg = document.getElementById('quiz-import-msg');
    const r = parseImportText(ta.value);
    // لو فيه صندوق فاضي لوحده نشيله قبل الإضافة
    document.querySelectorAll('#quiz-builder-area .qb').forEach(function(b) {
        if (!b.querySelector('.q-text').value.trim()) b.remove();
    });
    r.questions.forEach(function(q) { addQuestionField(q); });
    renumberBuilder();
    let t = 'تمت إضافة ' + r.questions.length + ' سؤال.';
    if (r.errors.length) t += ' تعذر قراءة الأسئلة رقم: ' + r.errors.join('، ') + ' (راجع تنسيقها).';
    msg.innerText = t;
    if (r.questions.length) ta.value = '';
}

let isSavingQuiz = false;

async function saveQuizData() {
    if (isSavingQuiz) return;
    const title = document.getElementById('quiz-title-input').value.trim();
    const imgInput = document.getElementById('quiz-image-input');
    const timeLimit = Math.max(0, parseInt(document.getElementById('quiz-time-input').value, 10) || 0);

    if (!title) { alert('اكتب عنوان الاختبار'); return; }

    const questions = [];
    const boxes = document.querySelectorAll('#quiz-builder-area .qb');
    let bad = 0;

    boxes.forEach(function(box, i) {
        if (bad) return;
        const type = box.dataset.type;
        const text = box.querySelector('.q-text').value.trim();
        if (!text) return;
        const correct = box.querySelector('.q-correct').value.trim();
        let options = [];

        if (type === 'mcq') {
            box.querySelectorAll('.q-opt').forEach(function(el) { options.push(el.value.trim()); });
            const chosen = parseInt(correct, 10) - 1;
            if (!options[chosen]) { bad = i + 1; return; }
            // نشيل الخيارات الفاضية مع تظبيط رقم الإجابة
            const mapped = options.map(function(o, k) { return { o: o, k: k }; }).filter(function(x) { return x.o; });
            const newCorrect = mapped.findIndex(function(x) { return x.k === chosen; }) + 1;
            if (mapped.length < 2) { bad = i + 1; return; }
            questions.push({ id: questions.length + 1, type: 'mcq', text: text, correct: String(newCorrect), options: mapped.map(function(x) { return x.o; }) });
        } else {
            questions.push({ id: questions.length + 1, type: type, text: text, correct: correct, options: [] });
        }
    });

    if (bad) { alert('السؤال رقم ' + bad + ' ناقص: لازم خيارين على الأقل والإجابة الصحيحة تكون خيار مكتوب.'); return; }
    if (questions.length === 0) { alert('أضف سؤال واحد على الأقل'); return; }

    isSavingQuiz = true;
    const quizId = String(Date.now());

    try {
        let imageUrl = null;
        if (imgInput && imgInput.files.length > 0) {
            imageUrl = await uploadToCloudinary(imgInput.files[0]);
        }

        const newQuiz = { title: title, timeLimit: timeLimit, image: imageUrl, questions: questions, createdAt: Date.now() };
        await setDoc(doc(db, "quizzes", quizId), newQuiz);
        cacheClear();
        closeModal('quiz-modal');
        await loadQuizzes(true);
        renderQuizzes();
    } catch (e) {
        console.error("Error saving quiz", e);
        alert('حدث خطأ أثناء حفظ الاختبار: ' + e.message);
    }
    isSavingQuiz = false;
}

async function deleteQuiz(e, id) {
    e.stopPropagation();
    if (!confirm('متأكد إنك عايز تحذف الاختبار؟')) return;
    try {
        await deleteDoc(doc(db, "quizzes", String(id)));
        cacheClear();
        await loadQuizzes(true);
        renderQuizzes();
    } catch (err) {
        console.error("Error deleting quiz", err);
    }
}

// ---------- بداية الحل ----------
function openQuizStart(quiz) {
    activeQuiz = quiz;
    const total = quiz.questions.length;
    document.getElementById('qs-title').innerText = quiz.title;
    document.getElementById('qs-info').innerText = total + ' سؤال' + (quiz.timeLimit > 0 ? ' • مدة الاختبار ' + quiz.timeLimit + ' دقيقة' : ' • بدون وقت محدد');

    const sel = document.getElementById('qs-count');
    sel.innerHTML = '<option value="all">كل الأسئلة (' + total + ')</option>';
    [10, 20, 30, 50, 100].forEach(function(n) {
        if (n < total) sel.innerHTML += '<option value="' + n + '">' + n + ' سؤال</option>';
    });
    document.querySelector('input[name="qs-mode"][value="first"]').checked = true;
    document.getElementById('qs-time-note').innerText = quiz.timeLimit > 0 ? 'لو اخترت عدد أقل، الوقت بيقل بنفس النسبة.' : '';
    document.getElementById('quiz-start-modal').style.display = 'flex';
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

function attemptKey(quizId) {
    return 'kh_done_' + quizId + '_' + (currentUser ? currentUser.uid : '');
}

// هل الطالب حل الاختبار ده وتصحح قبل كده؟ (الأدمن دايماً مسموح له)
async function hasAttempted(quizId) {
    if (!currentUser || currentUser.isAdmin) return false;
    try { if (localStorage.getItem(attemptKey(quizId)) === '1') return true; } catch (e) {}
    try {
        const snap = await getDoc(doc(db, 'attempts', quizId + '_' + currentUser.uid));
        if (snap.exists()) {
            try { localStorage.setItem(attemptKey(quizId), '1'); } catch (e) {}
            return true;
        }
    } catch (e) {
        console.error('Attempt check error:', e);
    }
    return false;
}

async function markAttempt(quizId) {
    if (!currentUser || currentUser.isAdmin) return;
    try { localStorage.setItem(attemptKey(quizId), '1'); } catch (e) {}
    try {
        await setDoc(doc(db, 'attempts', quizId + '_' + currentUser.uid), { quizId: quizId, uid: currentUser.uid, at: Date.now() });
    } catch (e) {
        console.error('Mark attempt error:', e);
    }
}

async function startQuiz() {
    const startBtn = document.querySelector('#quiz-start-modal .btn-submit');
    if (startBtn) { startBtn.disabled = true; startBtn.innerText = 'جاري التحضير...'; }
    const practice = await hasAttempted(activeQuiz.id);
    if (startBtn) { startBtn.disabled = false; startBtn.innerText = 'بدء الاختبار الان'; }
    const total = activeQuiz.questions.length;
    const v = document.getElementById('qs-count').value;
    const n = v === 'all' ? total : Math.min(total, parseInt(v, 10));
    const mode = document.querySelector('input[name="qs-mode"]:checked').value;
    let list = mode === 'random' ? shuffle(activeQuiz.questions) : activeQuiz.questions.slice();
    list = list.slice(0, n);

    const minutes = activeQuiz.timeLimit > 0 ? Math.max(1, Math.ceil(activeQuiz.timeLimit * n / total)) : 0;
    quizRun = {
        questions: list,
        minutes: minutes,
        startedAt: Date.now(),
        endAt: minutes ? Date.now() + minutes * 60000 : 0,
        submitted: false,
        practice: practice
    };
    closeModal('quiz-start-modal');
    renderQuizSolvePage();
}

function stopQuizTimer() {
    if (quizTimerId) { clearInterval(quizTimerId); quizTimerId = null; }
    const el = document.getElementById('quiz-timer');
    if (el) el.classList.remove('on', 'low');
}

function startQuizTimer() {
    stopQuizTimer();
    if (!quizRun || !quizRun.endAt) return;
    const el = document.getElementById('quiz-timer');
    const txt = document.getElementById('quiz-timer-text');
    if (el) el.classList.add('on');
    function tick() {
        const left = quizRun.endAt - Date.now();
        if (left <= 0) {
            if (txt) txt.innerText = '00:00';
            submitQuizAnswers(true);
            return;
        }
        if (txt) txt.innerText = fmt(left);
        if (el) el.classList.toggle('low', left <= 60000);
    }
    tick();
    quizTimerId = setInterval(tick, 500);
}

function renderQuizSolvePage() {
    document.getElementById('quiz-solve-title').innerText = activeQuiz.title;
    showPage('quiz-solve');
    window.scrollTo({ top: 0 });

    const body = document.getElementById('quiz-questions-body');
    let html = '';

    if (quizRun.review) {
        html += '<div class="practice-note">📝 وضع مراجعة الأخطاء: بتحل الأسئلة اللي غلطت فيها بس، وهتشوف الصح بعد التسليم. مفيش درجة ولا ترتيب.</div>';
    } else if (quizRun.practice) {
        html += '<div class="practice-note">⚠️ دي محاولة إضافية: تقدر تحل وتراجع الأسئلة، لكن مش هيتم تصحيحها ولا تدخل في الترتيب. التصحيح بيظهر في المحاولة الأولى بس.</div>';
    }

    if (activeQuiz.image) {
        html += '<div style="text-align:center; margin-bottom:1.5rem;"><img src="' + esc(activeQuiz.image) + '" style="max-width:100%; border-radius:12px; border:1px solid var(--card-border);"></div>';
    }

    quizRun.questions.forEach(function(q, idx) {
        const type = qType(activeQuiz, q);
        html += '<div class="quiz-item-box"><h4 style="color:var(--primary-gold); margin-bottom:0.8rem; line-height:1.8;">سـ ' + (idx + 1) + ': ' + esc(q.text) + '</h4>';

        if (type === 'tf') {
            html += '<label class="quiz-option-label"><input type="radio" name="q_' + idx + '" value="صح"> (✅) صح</label>';
            html += '<label class="quiz-option-label"><input type="radio" name="q_' + idx + '" value="غلط"> (❌) غلط</label>';
        } else if (type === 'mcq') {
            (q.options || []).forEach(function(opt, optIdx) {
                html += '<label class="quiz-option-label"><input type="radio" name="q_' + idx + '" value="' + (optIdx + 1) + '"> ' + (optIdx + 1) + '. ' + esc(opt) + '</label>';
            });
        } else {
            html += '<textarea name="q_' + idx + '" placeholder="اكتب إجابتك هنا..." rows="3" style="width:100%; padding:0.8rem; background:var(--input-bg); border:1px solid var(--card-border); border-radius:8px; color:var(--text-main); outline:none; margin-top:0.5rem;"></textarea>';
        }
        html += '</div>';
    });

    html += '<button id="quiz-submit-btn" class="btn-submit" style="padding:1rem; font-size:1.1rem; margin-top:1rem;" onclick="submitQuizAnswers()">ارسال الحل والتصحيح التلقائي</button>';
    html += '<div id="quiz-results-area" style="margin-top:1.5rem;"></div>';

    body.innerHTML = html;
    startQuizTimer();
}

function reviewMistakes() {
    if (!quizWrong.length) return;
    quizRun = {
        questions: quizWrong.slice(),
        minutes: 0,
        startedAt: Date.now(),
        endAt: 0,
        submitted: false,
        practice: true,
        review: true
    };
    renderQuizSolvePage();
}

function gradeOf(score, percent) {
    if (score === 0) return { label: 'راسب', cls: 'g-fail' };
    if (percent < 40) return { label: 'مقبول', cls: 'g-ok' };
    if (percent < 70) return { label: 'جيد', cls: 'g-good' };
    if (percent < 90) return { label: 'جيد جداً', cls: 'g-vgood' };
    return { label: 'ممتاز', cls: 'g-excellent' };
}

function submitQuizAnswers(auto) {
    if (!quizRun || quizRun.submitted) return;
    quizRun.submitted = true;
    stopQuizTimer();

    // وضع مراجعة الأخطاء: تصحيح فوري بدون درجة وبدون ترتيب
    if (quizRun.review) {
        let right = 0;
        document.querySelectorAll('#quiz-questions-body input, #quiz-questions-body textarea').forEach(function(el) { el.disabled = true; });
        const boxes = document.querySelectorAll('#quiz-questions-body .quiz-item-box');
        quizRun.questions.forEach(function(q, idx) {
            const sel = document.querySelector('input[name="q_' + idx + '"]:checked');
            const ok = !!sel && sel.value === String(q.correct);
            if (ok) right++;
            const type = qType(activeQuiz, q);
            const corr = type === 'mcq' ? q.correct + '. ' + ((q.options || [])[parseInt(q.correct, 10) - 1] || '') : q.correct;
            const m = document.createElement('div');
            m.className = 'review-mark ' + (ok ? 'ok' : 'bad');
            m.textContent = ok ? '✔ إجابة صحيحة' : '✖ الإجابة الصحيحة: ' + corr;
            if (boxes[idx]) boxes[idx].appendChild(m);
        });
        const sbr = document.getElementById('quiz-submit-btn');
        if (sbr) sbr.style.display = 'none';
        const areaR = document.getElementById('quiz-results-area');
        areaR.innerHTML = '<div class="quiz-result-card"><h3 style="text-align:center; color:var(--accent-cyan);">انتهت المراجعة</h3><p style="text-align:center; margin-top:0.6rem;">صح ' + right + ' من ' + quizRun.questions.length + ' (للمراجعة بس، مش بتدخل في الدرجة).</p></div>';
        areaR.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    // محاولة إضافية: بدون تصحيح وبدون ترتيب
    if (quizRun.practice) {
        document.querySelectorAll('#quiz-questions-body input, #quiz-questions-body textarea').forEach(function(el) { el.disabled = true; });
        const sbp = document.getElementById('quiz-submit-btn');
        if (sbp) sbp.style.display = 'none';
        const areaP = document.getElementById('quiz-results-area');
        areaP.innerHTML = '<div class="quiz-result-card"><h3 style="text-align:center; color:var(--accent-cyan);">تم تسليم إجاباتك</h3>' +
            (auto ? '<p style="text-align:center; color:var(--danger); margin-top:0.4rem;">⏱ انتهى الوقت</p>' : '') +
            '<p style="text-align:center; color:var(--text-muted); margin-top:0.8rem; line-height:1.8;">دي مش محاولتك الأولى في الاختبار ده، فمفيش تصحيح ولا درجة. تقدر ترجع تراجع الأسئلة بالأعلى.</p></div>';
        areaP.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    // أول محاولة: نسجلها فوراً عشان المرات الجاية تبقى بدون تصحيح
    markAttempt(activeQuiz.id);

    const timeSec = Math.round((Date.now() - quizRun.startedAt) / 1000);
    let score = 0, gradable = 0;
    let review = '';
    quizWrong = [];

    quizRun.questions.forEach(function(q, idx) {
        const type = qType(activeQuiz, q);
        let userAns = '';
        let ok = null;

        if (type === 'essay') {
            const ta = document.querySelector('textarea[name="q_' + idx + '"]');
            userAns = ta ? ta.value.trim() : '';
        } else {
            gradable++;
            const sel = document.querySelector('input[name="q_' + idx + '"]:checked');
            userAns = sel ? sel.value : '';
            ok = (userAns === String(q.correct));
            if (ok) score++;
            else quizWrong.push(q);
        }

        function show(ans) {
            if (!ans) return 'لم يتم الحل';
            if (type === 'mcq') return ans + '. ' + esc((q.options || [])[parseInt(ans, 10) - 1] || '');
            return esc(ans);
        }

        review += '<div style="border-bottom:1px dashed var(--card-border); padding:0.8rem 0; text-align:right;">';
        review += '<p style="font-weight:bold; line-height:1.8;">' + (idx + 1) + '. ' + esc(q.text) + '</p>';
        if (type === 'essay') {
            review += '<p style="font-size:0.85rem;">إجابتك: ' + (userAns ? esc(userAns) : 'فارغ') + '</p>';
            review += '<p style="font-size:0.8rem; color:var(--primary-gold); margin-top:0.2rem;">الإجابة النموذجية: ' + esc(q.correct) + '</p>';
        } else {
            review += '<p style="font-size:0.85rem; color:' + (ok ? 'var(--primary-gold)' : 'var(--danger)') + ';">إجابتك: ' + show(userAns) + (ok ? ' ✔' : ' ✖') + '</p>';
            if (!ok) review += '<p style="font-size:0.85rem; color:var(--primary-gold);">الإجابة الصحيحة: ' + show(String(q.correct)) + '</p>';
        }
        review += '</div>';
    });

    document.querySelectorAll('#quiz-questions-body input, #quiz-questions-body textarea').forEach(function(el) { el.disabled = true; });
    const sb = document.getElementById('quiz-submit-btn');
    if (sb) sb.style.display = 'none';

    let head = '<div class="quiz-result-card">';
    head += '<h3 style="color:var(--accent-cyan); text-align:center;">نتيجة ' + esc(currentUser ? currentUser.name : '') + '</h3>';
    if (auto) head += '<p style="text-align:center; color:var(--danger); margin-top:0.4rem;">⏱ انتهى الوقت وتم تسليم إجاباتك تلقائياً</p>';

    let percent = 0;
    if (gradable > 0) {
        percent = Math.round(score / gradable * 1000) / 10;
        const g = gradeOf(score, percent);
        head += '<div class="grade-badge ' + g.cls + '">' + g.label + '</div>';
        head += '<h2 style="text-align:center; color:var(--primary-gold);">' + score + ' من ' + gradable + ' — ' + percent + '%</h2>';
    } else {
        head += '<p style="text-align:center; margin-top:0.8rem;">الأسئلة كلها مقالية، قارن إجاباتك بالنموذجية.</p>';
    }
    head += '<p style="text-align:center; color:var(--text-muted); font-size:0.85rem; margin-top:0.4rem;">الوقت المستغرق: ' + fmt(timeSec * 1000) + '</p>';
    head += '<p id="quiz-save-note" style="text-align:center; font-size:0.85rem; margin-top:0.4rem; color:var(--text-muted);"></p>';
    if (gradable > 0) head += '<button class="btn-track-secondary" style="margin:0.8rem auto 0; width:100%; max-width:260px;" onclick="openLeaderboard(\'' + activeQuiz.id + '\')"><i class="fa-solid fa-trophy"></i> عرض الترتيب</button>';
    if (quizWrong.length) head += '<button class="btn-track-secondary" style="margin:0.6rem auto 0; width:100%; max-width:260px;" onclick="reviewMistakes()"><i class="fa-solid fa-rotate-left"></i> راجع أخطائي (' + quizWrong.length + ')</button>';
    if (quizRun.questions.some(function(q) { return qType(activeQuiz, q) === 'essay'; })) {
        head += '<p style="text-align:center; color:var(--text-muted); font-size:0.78rem; margin-top:0.6rem;">الأسئلة المقالية لا تدخل في الدرجة.</p>';
    }
    head += '<div style="margin-top:1rem;">' + review + '</div></div>';

    const area = document.getElementById('quiz-results-area');
    area.innerHTML = head;
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (gradable > 0) saveQuizResult(score, gradable, percent, timeSec);
}

// ---------- حفظ النتيجة والترتيب ----------
async function saveQuizResult(score, gradable, percent, timeSec) {
    const note = document.getElementById('quiz-save-note');
    if (!currentUser || !currentUser.uid) return;
    try {
        const ref = doc(db, 'results', activeQuiz.id + '_' + currentUser.uid);
        const old = await getDoc(ref);
        if (old.exists()) {
            const o = old.data();
            if (o.percent > percent || (o.percent === percent && o.timeSec <= timeSec)) {
                if (note) note.innerText = 'أفضل نتيجة ليك في الترتيب فضلت زي ما هي (' + o.percent + '%).';
                return;
            }
        }
        await setDoc(ref, {
            quizId: activeQuiz.id,
            quizTitle: activeQuiz.title,
            uid: currentUser.uid,
            name: currentUser.name,
            score: score,
            total: gradable,
            percent: percent,
            timeSec: timeSec,
            createdAt: Date.now()
        });
        try { localStorage.removeItem('kh_cache_lb_' + activeQuiz.id); } catch (e) {}
        if (note) note.innerText = '✅ تم حفظ نتيجتك في الترتيب.';
    } catch (e) {
        console.error('Save result error:', e);
        if (note) note.innerText = 'تعذر حفظ النتيجة في الترتيب.';
    }
}

let lbCurrent = null;

async function openLeaderboard(quizId) {
    document.getElementById('leaderboard-modal').style.display = 'flex';
    const tabs = document.getElementById('lb-tabs');
    tabs.innerHTML = '';
    document.getElementById('lb-body').innerHTML = '<p class="lb-empty">جاري التحميل...</p>';
    try { await loadQuizzes(); } catch (e) { console.error(e); }

    if (quizzes.length === 0) {
        document.getElementById('lb-body').innerHTML = '<p class="lb-empty">لا توجد اختبارات بعد.</p>';
        return;
    }
    quizzes.forEach(function(q) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lb-tab';
        b.dataset.id = q.id;
        b.textContent = q.title;
        b.addEventListener('click', function() { loadLeaderboard(q.id); });
        tabs.appendChild(b);
    });
    const first = (quizId && quizzes.some(function(q) { return q.id === quizId; })) ? quizId : quizzes[0].id;
    loadLeaderboard(first);
}

async function loadLeaderboard(id) {
    lbCurrent = id;
    document.querySelectorAll('#lb-tabs .lb-tab').forEach(function(b) {
        b.classList.toggle('active', b.dataset.id === id);
    });
    const body = document.getElementById('lb-body');
    body.innerHTML = '<p class="lb-empty">جاري التحميل...</p>';

    try {
        let rows = cacheGet('lb_' + id);
        if (!rows) {
            const snap = await getDocs(query(collection(db, 'results'), where('quizId', '==', id)));
            rows = [];
            snap.forEach(function(d) { rows.push(d.data()); });
            cacheSet('lb_' + id, rows);
        }
        if (lbCurrent !== id) return;
        rows.sort(function(a, b) { return (b.percent - a.percent) || (a.timeSec - b.timeSec); });

        if (rows.length === 0) { body.innerHTML = '<p class="lb-empty">لا توجد نتائج لهذا الاختبار بعد. كن أول المتصدرين!</p>'; return; }

        const medals = ['🥇', '🥈', '🥉'];
        let html = '<table class="lb-table"><thead><tr><th>#</th><th>الاسم</th><th>الدرجة</th><th>الوقت</th></tr></thead><tbody>';
        rows.slice(0, 20).forEach(function(r, i) {
            const me = currentUser && r.uid === currentUser.uid;
            html += '<tr class="' + (me ? 'me' : '') + '"><td>' + (medals[i] || (i + 1)) + '</td><td>' + esc(r.name) + '</td><td>' + r.percent + '%<small> (' + r.score + '/' + r.total + ')</small></td><td>' + fmt(r.timeSec * 1000) + '</td></tr>';
        });
        html += '</tbody></table>';

        const myIdx = currentUser ? rows.findIndex(function(r) { return r.uid === currentUser.uid; }) : -1;
        if (myIdx >= 20) html += '<p class="lb-mine">ترتيبك: ' + (myIdx + 1) + ' من ' + rows.length + ' (' + rows[myIdx].percent + '%)</p>';
        else if (myIdx < 0) html += '<p class="lb-mine">لسه ما حليتش الاختبار ده.</p>';
        body.innerHTML = html;
    } catch (e) {
        console.error('Leaderboard error:', e);
        body.innerHTML = '<p class="lb-empty">تعذر تحميل الترتيب الآن.</p>';
    }
}

function openAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'flex';
}

function openWhatsAppModal() {
    const modal = document.getElementById('whatsapp-modal');
    if (modal) modal.style.display = 'flex';
}

function closeModal(id) { 
    const m = document.getElementById(id);
    if (m) m.style.display = 'none'; 
}

window.showPage = showPage;
window.pomoToggle = pomoToggle;
window.pomoReset = pomoReset;
window.pomoSkip = pomoSkip;
window.pomoPanel = pomoPanel;
window.closeVerse = closeVerse;
window.toggleTheme = toggleTheme;
window.handleAuth = handleAuth;
window.logout = logout;
window.openAuthModal = openAuthModal;
window.openWhatsAppModal = openWhatsAppModal;
window.closeModal = closeModal;
window.scrollToTop = scrollToTop;
window.renderSubjects = renderSubjects;
window.openAddSubjectModal = openAddSubjectModal;
window.saveSubject = saveSubject;
window.deleteSubject = deleteSubject;
window.openSubjectDetail = openSubjectDetail;
window.goBackToTrack = goBackToTrack;
window.openAddLectureModal = openAddLectureModal;
window.addLinkRow = addLinkRow;
window.renderLectures = renderLectures;
window.openEditLecture = openEditLecture;
window.moveLecture = moveLecture;
window.toggleStudied = toggleStudied;
window.openAnnounceModal = openAnnounceModal;
window.saveAnnouncement = saveAnnouncement;
window.reviewMistakes = reviewMistakes;
window.saveLectureData = saveLectureData;
window.deleteLecture = deleteLecture;
window.openLectureDetail = openLectureDetail;
window.viewMedia = viewMedia;
window.goBackToSubject = goBackToSubject;
window.renderQuizzes = renderQuizzes;
window.openAddQuizModal = openAddQuizModal;
window.addQuestionField = addQuestionField;
window.saveQuizData = saveQuizData;
window.deleteQuiz = deleteQuiz;
window.openQuizStart = openQuizStart;
window.startQuiz = startQuiz;
window.importQuestions = importQuestions;
window.openLeaderboard = openLeaderboard;
window.loadLeaderboard = loadLeaderboard;
window.setAuthMode = setAuthMode;
window.resetPassword = resetPassword;
window.submitQuizAnswers = submitQuizAnswers;
window.triggerUpdateProcess = triggerUpdateProcess;

// ربط زرار حفظ المحاضرة (مرة واحدة فقط)
const saveLectureBtnEl = document.getElementById('saveLectureBtn');
if (saveLectureBtnEl) {
    saveLectureBtnEl.addEventListener('click', saveLectureData);
}

// قفل نافذة عرض الملفات بزرار Esc أو بالضغط على الخلفية
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal('media-view-modal');
});

const mediaModalEl = document.getElementById('media-view-modal');
if (mediaModalEl) {
    mediaModalEl.addEventListener('click', function(e) {
        if (e.target === mediaModalEl) closeModal('media-view-modal');
    });
}

// زرار Enter في نافذة الدخول
['auth-email', 'auth-pass', 'auth-pass2', 'auth-name'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleAuth(); });
});